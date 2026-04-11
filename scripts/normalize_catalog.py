#!/usr/bin/env python3
import csv
import hashlib
import json
import os
import re
import sys
from urllib.parse import urlparse


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

CATEGORY_RULES = [
    ("Multi-Use Guest Seating", ["guest seating", "guest chair", "guest chairs", "multi-use guest seating", "multi-use guest chairs"]),
    ("Lounge Seating", ["lounge seating", "lounge chair", "lounge chairs", "lounge"]),
    ("Stacking / Nesting Chairs", ["stacking chair", "stacking chairs", "nesting chair", "nesting chairs"]),
    ("High-Performing Chairs / Stools", ["task chair", "task chairs", "work chair", "work chairs", "office chair", "office chairs"]),
    ("Bench Seating", ["bench", "bench seating", "benches"]),
    ("Occasional Tables", ["occasional table", "occasional tables", "side table", "side tables", "coffee table", "coffee tables"]),
    ("Fixed-Height Stools", ["stool", "stools", "bar stool", "counter stool"]),
]


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


def create_id(prefix, *parts):
    joined = "::".join([part for part in parts if part])
    digest = hashlib.sha1(joined.encode("utf-8")).hexdigest()[:12]
    return f"{prefix}_{digest}"


def slug_catalog_product_id(brand, name, raw_product_id):
    prefix = create_id("product", brand, name)
    suffix = re.sub(r"[^a-z0-9]+", "-", raw_product_id.lower()).strip("-")
    return f"{prefix}_{suffix}"


def canonicalize_category(raw_category):
    normalized = normalize_whitespace(raw_category).lower()
    for canonical, phrases in CATEGORY_RULES:
        if any(phrase in normalized for phrase in phrases):
            return canonical
    return normalize_whitespace(raw_category)


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

    for row in rows:
        raw_product_id = normalize_whitespace(row.get("Product ID"))
        name = normalize_whitespace(row.get("Product Name"))
        brand = normalize_whitespace(row.get("Brand Name") or row.get("Brand"))
        designer_category = normalize_whitespace(row.get("User Selected Category Name") or row.get("DP Categories"))
        category_a = split_category_values(row.get("A level Names"))
        category_b = split_category_values(row.get("B Level Names"))
        category_c = split_category_values(row.get("C Level Names"))
        image_url = normalize_whitespace(row.get("Image Url") or row.get("Image URL"))

        if not raw_product_id or not name or not brand or not image_url or not looks_like_image_url(image_url):
            continue

        primary_a = category_a[0] if category_a else ""
        primary_b = category_b[0] if category_b else ""
        primary_category = " > ".join(part for part in [primary_a, primary_b] if part)
        category = canonicalize_category(primary_category or designer_category)
        product_id = slug_catalog_product_id(brand, name, raw_product_id)

        products.append(
            {
                "product_id": product_id,
                "name": name,
                "brand": brand,
                "description": "",
                "category": category,
                "raw_category": designer_category,
                "designer_category": designer_category,
                "primary_category": primary_category,
                "categories": {
                    "a": category_a,
                    "b": category_b,
                    "c": category_c,
                },
                "product_image": image_url,
                "website": normalize_whitespace(row.get("Product URL")),
                "source_file": file_name,
                "image_urls": [image_url],
            }
        )

    return products


def normalize_catalog(csv_directory):
    products = []
    if os.path.isfile(csv_directory):
        products.extend(normalize_project_csv(csv_directory))
    else:
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
                category = canonicalize_category(raw_category)
                product_id_value = normalize_whitespace(row.get("Product ID"))
                product_id = (
                    slug_catalog_product_id(brand, name, product_id_value)
                    if product_id_value and product_id_value.lower() != "new"
                    else create_id("product", file_name, brand, name, raw_category)
                )

                image_urls = unique_strings(
                    value
                    for value in row.values()
                    if normalize_whitespace(value).startswith("http") and looks_like_image_url(value)
                )

                if not image_urls:
                    continue

                products.append(
                    {
                        "product_id": product_id,
                        "name": name,
                        "brand": brand,
                        "description": normalize_whitespace(row.get("Description")),
                        "category": category,
                        "raw_category": raw_category,
                        "website": normalize_whitespace(row.get("Website")),
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
                    "category": product["category"],
                    "image_url": image_url,
                    "source_file": product["source_file"],
                }
            )

    return {
        "generated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "totals": {"products": len(products), "images": len(images)},
        "brands": sorted(unique_strings(product["brand"] for product in products)),
        "categories": sorted(unique_strings(product["category"] for product in products)),
        "products": products,
        "images": images,
    }


if __name__ == "__main__":
    csv_directory = sys.argv[1] if len(sys.argv) > 1 else "Product Data with Images"
    print(json.dumps(normalize_catalog(csv_directory)))
