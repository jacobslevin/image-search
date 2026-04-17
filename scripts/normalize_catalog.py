#!/usr/bin/env python3
import csv
import hashlib
import html
import json
import os
import re
import sys
import urllib.error
import urllib.request
from urllib.parse import urlparse


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
DEFAULT_REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; CatalogNormalizer/1.0; +https://designerpages.com)"
}


def normalize_whitespace(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def split_category_values(value):
    items = []
    for item in str(value or "").split("::"):
        normalized = normalize_whitespace(item)
        if normalized and normalized != "0":
            items.append(normalized)
    return unique_strings(items)


def unique_strings(values):
    seen = set()
    items = []
    for value in values:
      normalized = normalize_whitespace(value)
      if normalized and normalized not in seen:
        seen.add(normalized)
        items.append(normalized)
    return items


def looks_like_image_url(value):
    if not value:
        return False
    try:
        parsed = urlparse(value.strip())
    except Exception:
        return False
    path = parsed.path.lower()
    return any(path.endswith(extension) for extension in IMAGE_EXTENSIONS)


def normalize_dp_image_url(value):
    url = normalize_whitespace(value)
    if "content.designerpages.com" not in url.lower():
        return url
    return re.sub(r"_large(?=\.[A-Za-z0-9]+(?:[?#].*)?$)", "", url, flags=re.IGNORECASE)


def split_image_urls(value):
    return unique_strings(
        normalize_dp_image_url(item)
        for item in str(value or "").split(",")
    )


def is_designerpages_product_url(value):
    normalized = normalize_whitespace(value)
    if not normalized:
        return False

    try:
        parsed = urlparse(normalized)
    except Exception:
        return False

    host = (parsed.netloc or "").lower()
    path = parsed.path or ""
    return (
        host in {"designerpages.com", "www.designerpages.com"}
        and re.match(r"^/products/\d+(?:/[^/?#]*)?/?$", path) is not None
    )


def fetch_html(url):
    request = urllib.request.Request(url, headers=DEFAULT_REQUEST_HEADERS)
    with urllib.request.urlopen(request, timeout=20) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def parse_designerpages_gallery_images(page_html):
    if not page_html:
        return []

    match = re.search(
        r'<div[^>]*class="[^"]*\bimage-column\b[^"]*"[^>]*data-source-data=(["\'])(.*?)\1',
        page_html,
        re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return []

    raw_payload = html.unescape(match.group(2))
    try:
        source_data = json.loads(raw_payload)
    except json.JSONDecodeError:
        return []

    images = []
    default_image = source_data.get("default_image") or {}
    additional_images = source_data.get("additional_images") or []

    if isinstance(default_image, dict):
        default_url = normalize_dp_image_url(default_image.get("url"))
        if looks_like_image_url(default_url):
            images.append(default_url)

    for image in additional_images:
        if not isinstance(image, dict):
            continue
        image_url = normalize_dp_image_url(image.get("url"))
        if looks_like_image_url(image_url):
            images.append(image_url)

    return unique_strings(images)


def extract_live_image_urls(website, page_cache):
    normalized = normalize_whitespace(website)
    if not is_designerpages_product_url(normalized):
        return []

    if normalized not in page_cache:
        try:
            page_cache[normalized] = parse_designerpages_gallery_images(fetch_html(normalized))
        except (urllib.error.URLError, TimeoutError, ValueError):
            page_cache[normalized] = []

    return page_cache[normalized]


def create_id(prefix, *parts):
    joined = "::".join([part for part in parts if part])
    digest = hashlib.sha1(joined.encode("utf-8")).hexdigest()[:12]
    return f"{prefix}_{digest}"


def slug_catalog_product_id(brand, name, raw_product_id):
    prefix = create_id("product", brand, name)
    suffix = re.sub(r"[^a-z0-9]+", "-", raw_product_id.lower()).strip("-")
    return f"{prefix}_{suffix}"


def load_rows(csv_path):
    with open(csv_path, "r", encoding="latin1", newline="") as handle:
        reader = csv.reader(handle)
        headers = next(reader)
        normalized_headers = []
        for index, header in enumerate(headers):
            normalized = normalize_whitespace(header)
            normalized_headers.append(normalized if normalized else f"unnamed_{index}")

        rows = []
        for cells in reader:
            row = {}
            for index, header in enumerate(normalized_headers):
                row[header] = cells[index] if index < len(cells) else ""
            rows.append(row)
        return rows


def normalize_project_csv(csv_path):
    file_name = os.path.basename(csv_path)
    rows = load_rows(csv_path)
    products = []
    page_cache = {}

    for row in rows:
        raw_product_id = normalize_whitespace(row.get("Product ID"))
        name = normalize_whitespace(row.get("Product Name"))
        brand = normalize_whitespace(row.get("Brand Name") or row.get("Brand"))
        raw_category = normalize_whitespace(row.get("User Selected Category Name") or row.get("DP Categories"))
        a_level = split_category_values(row.get("A level Names"))
        b_level = split_category_values(row.get("B Level Names"))
        c_level = split_category_values(row.get("C Level Names"))
        website = normalize_whitespace(row.get("Product URL") or row.get("Website"))
        csv_image_urls = [
            value for value in split_image_urls(row.get("Image Url") or row.get("Image URL"))
            if looks_like_image_url(value)
        ]
        image_urls = extract_live_image_urls(website, page_cache) or csv_image_urls
        image_url = image_urls[0] if image_urls else ""

        if not raw_product_id or not name or not brand or not image_urls:
            continue

        product_id = slug_catalog_product_id(brand, name, raw_product_id)

        products.append(
            {
                "product_id": product_id,
                "name": name,
                "brand": brand,
                "description": "",
                "raw_category": raw_category,
                "a_level": a_level,
                "b_level": b_level,
                "c_level": c_level,
                "product_image": image_url,
                "website": website,
                "source_file": file_name,
                "image_urls": image_urls,
            }
        )

    return products


def normalize_catalog(csv_directory):
    products = []
    if os.path.isfile(csv_directory):
        products.extend(normalize_project_csv(csv_directory))
    else:
        page_cache = {}
        for file_name in sorted(os.listdir(csv_directory)):
            if not file_name.lower().endswith(".csv"):
                continue

            rows = load_rows(os.path.join(csv_directory, file_name))
            for row in rows:
                name = normalize_whitespace(row.get("Name"))
                if not name:
                    continue

                brand = normalize_whitespace(row.get("Manufacturer"))
                raw_category = normalize_whitespace(row.get("Category"))
                website = normalize_whitespace(row.get("Website"))
                product_id_value = normalize_whitespace(row.get("Product ID"))
                product_id = (
                    slug_catalog_product_id(brand, name, product_id_value)
                    if product_id_value and product_id_value.lower() != "new"
                    else create_id("product", file_name, brand, name, raw_category)
                )

                csv_image_urls = unique_strings(
                    normalize_dp_image_url(value)
                    for value in row.values()
                    if normalize_whitespace(value).startswith("http") and looks_like_image_url(value)
                )
                image_urls = extract_live_image_urls(website, page_cache) or csv_image_urls

                if not image_urls:
                    continue

                products.append(
                    {
                        "product_id": product_id,
                        "name": name,
                        "brand": brand,
                        "description": normalize_whitespace(row.get("Description")),
                        "raw_category": raw_category,
                        "a_level": [],
                        "b_level": split_category_values(raw_category),
                        "c_level": [],
                        "website": website,
                        "source_file": file_name,
                        "image_urls": image_urls,
                    }
                )

    images = []
    for product in products:
        for index, image_url in enumerate(product["image_urls"], start=1):
            images.append(
                {
                    "image_id": f"{product['product_id']}_img_{index:03d}",
                    "product_id": product["product_id"],
                    "name": product["name"],
                    "brand": product["brand"],
                    "a_level": product.get("a_level", []),
                    "b_level": product.get("b_level", []),
                    "c_level": product.get("c_level", []),
                    "image_url": image_url,
                    "source_file": product["source_file"],
                }
            )

    return {
        "generated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "totals": {"products": len(products), "images": len(images)},
        "brands": sorted(unique_strings(product["brand"] for product in products)),
        "categories": sorted(unique_strings(category for product in products for category in product.get("b_level", []))),
        "products": products,
        "images": images,
    }


if __name__ == "__main__":
    csv_directory = sys.argv[1] if len(sys.argv) > 1 else "Product Data with Images"
    print(json.dumps(normalize_catalog(csv_directory)))
