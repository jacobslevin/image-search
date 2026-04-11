#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import pdfParse from "pdf-parse";

function parseArgs(argv = []) {
  const args = {
    input: "Sample PDFs",
    output: "data/pdf-text-extract.json"
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--input" && argv[i + 1]) {
      args.input = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--output" && argv[i + 1]) {
      args.output = argv[i + 1];
      i += 1;
      continue;
    }
  }

  return args;
}

async function collectPdfFiles(inputPath) {
  const stat = await fs.stat(inputPath);
  if (stat.isFile()) {
    if (inputPath.toLowerCase().endsWith(".pdf")) {
      return [inputPath];
    }
    return [];
  }

  const files = [];
  const entries = await fs.readdir(inputPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(inputPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectPdfFiles(fullPath);
      files.push(...nested);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
      files.push(fullPath);
    }
  }
  return files;
}

function normalizePdfText(value = "") {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractFromPdf(pdfPath) {
  const buffer = await fs.readFile(pdfPath);
  const parsed = await pdfParse(buffer);
  return {
    file: pdfPath,
    info: parsed.info || {},
    metadata: parsed.metadata || null,
    pages: Number(parsed.numpages || 0),
    text_length: Number(String(parsed.text || "").length),
    text: normalizePdfText(parsed.text || "")
  };
}

async function main() {
  const { input, output } = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(input);
  const outputPath = path.resolve(output);
  const outputDir = path.dirname(outputPath);

  const files = await collectPdfFiles(inputPath);
  if (!files.length) {
    throw new Error(`No PDF files found in ${inputPath}`);
  }

  const results = [];
  for (const file of files.sort()) {
    try {
      const extracted = await extractFromPdf(file);
      results.push(extracted);
      console.log(`Extracted: ${path.basename(file)} (${extracted.pages} pages)`);
    } catch (error) {
      results.push({
        file,
        error: error?.message || "Unknown extraction error"
      });
      console.error(`Failed: ${path.basename(file)} -> ${error?.message || "Unknown extraction error"}`);
    }
  }

  const payload = {
    extracted_at: new Date().toISOString(),
    input: inputPath,
    total_files: results.length,
    results
  };

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const okCount = results.filter((entry) => !entry.error).length;
  const failedCount = results.length - okCount;
  console.log(`Done. ${okCount} succeeded, ${failedCount} failed. Output: ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
