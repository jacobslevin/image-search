import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function normalizeCatalog(csvDirectory) {
  const { stdout } = await execFileAsync("python3", ["scripts/normalize_catalog.py", csvDirectory], {
    maxBuffer: 1024 * 1024 * 50
  });

  return JSON.parse(stdout);
}
