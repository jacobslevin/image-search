import { ensureDevDatabase, initializeSchema, DEV_DATABASE_NAME } from "./postgres-dev-common.js";

async function main() {
  await ensureDevDatabase();
  await initializeSchema();
  console.log(`PostgreSQL dev database ready: ${DEV_DATABASE_NAME}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
