#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { stdin as input, stdout as output } from "node:process";
import Database from "better-sqlite3";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const markerIds = ["B8", "C6", "D7", "E5", "F7"];
const agentEnvironmentKeys = ["TILLER_SLICE", "TILLER_RUN_DIR", "TILLER_ATTEMPT", "TILLER_SEAT"];
const confirmationPhrase = "RELEASE COMMAND CENTER";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

function preReleaseSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error("could not determine pre-release git SHA");
  return result.stdout.trim();
}

function requireGreenMarkers() {
  const missing = markerIds.filter((id) => !fs.existsSync(path.join(root, "AGJ_Upgrade", "command-center-2026-08-26", "dispatch", `advance-${id}.marker`)));
  if (missing.length > 0) throw new Error(`required green markers are missing: ${missing.join(", ")}`);
}

async function backupDatabase(sourcePath, backupPath) {
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(backupPath);
  } finally {
    source.close();
  }
}

function migrateDatabase(dbPath) {
  const result = spawnSync(
    process.execPath,
    [
      "--import", "tsx", "--input-type=module", "--eval",
      "import { DatabaseService } from './src/db/database.ts'; const db = new DatabaseService(process.argv[1]); db.close();",
      dbPath
    ],
    { cwd: root, stdio: "inherit" }
  );
  if (result.status !== 0) throw new Error("database migration failed");
}

function timestamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "");
}

function printRollback(backupPath, sourcePath, sha) {
  console.log(`[release-command-center] backup: ${backupPath}`);
  console.log(`[release-command-center] rollback code: git reset --hard ${sha}`);
  console.log(`[release-command-center] rollback database: cp ${backupPath} ${sourcePath}`);
}

function hasAgentEnvironment() {
  return agentEnvironmentKeys.some((key) => process.env[key] !== undefined);
}

async function confirmHumanExecute() {
  if (!input.isTTY) throw new Error("--execute requires an interactive TTY");
  const terminal = readline.createInterface({ input, output });
  try {
    const answer = await terminal.question(`Type ${confirmationPhrase} to release command center: `);
    if (answer !== confirmationPhrase) throw new Error("confirmation phrase did not match");
  } finally {
    terminal.close();
  }
}

async function dryRun(sourcePath, sha) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-release-"));
  const backupPath = `${sourcePath}.pre-release-${timestamp()}.bak`;
  const migrationCopy = path.join(tmpDir, path.basename(sourcePath));
  try {
    await backupDatabase(sourcePath, backupPath);
    fs.copyFileSync(backupPath, migrationCopy);
    migrateDatabase(migrationCopy);
    printRollback(backupPath, sourcePath, sha);
    console.log("[release-command-center] DRY RUN passed; a temporary DB copy was migrated.");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function execute(sourcePath, sha) {
  const backupPath = `${sourcePath}.pre-release-${timestamp()}.bak`;
  await backupDatabase(sourcePath, backupPath);
  migrateDatabase(sourcePath);
  run("pm2", ["restart", "agjassist"]);
  printRollback(backupPath, sourcePath, sha);
  console.log("[release-command-center] execute completed");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--dry-run" && arg !== "--execute") || (args.includes("--dry-run") && args.includes("--execute"))) {
    throw new Error("usage: node scripts/release-command-center.mjs [--dry-run|--execute]");
  }

  const executeRequested = args.includes("--execute");
  if (executeRequested && hasAgentEnvironment()) {
    throw new Error("--execute is refused from a tiller or agent environment");
  }
  if (executeRequested) await confirmHumanExecute();

  requireGreenMarkers();
  const sha = preReleaseSha();
  run("npm", ["run", "build"]);
  const sourcePath = path.resolve(root, process.env.DB_PATH || "data/agjassist.db");
  if (!fs.existsSync(sourcePath)) throw new Error(`DB_PATH does not exist: ${sourcePath}`);

  if (executeRequested) await execute(sourcePath, sha);
  else await dryRun(sourcePath, sha);
}

main().catch((error) => {
  console.error(`[release-command-center] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
