#!/usr/bin/env node
// Runs as the first step of wrangler's build.command, before wrangler validates bindings and
// deploys. Resolves the real database_id for "imghost-db" by name every time — creating the
// database if it doesn't exist yet — and rewrites wrangler.jsonc with the current id.
//
// This exists because a D1 binding has to resolve to one specific database at deploy time (a
// Worker can access any of several databases in an account, so Cloudflare needs a stable id, not
// just a name that could get reused after a delete). That's a real platform constraint — but
// nothing says a human has to go look that id up by hand. If the database was ever deleted and
// recreated (or this is a fresh account via the Deploy button), this makes deploy self-healing
// instead of failing with "database not found" until someone manually runs `wrangler d1 list`
// and pastes the uuid into wrangler.jsonc.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DB_NAME = "imghost-db";
const CONFIG_PATH = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));

function run(args) {
  return execFileSync("npx", args, { encoding: "utf8" });
}

function findExistingDatabaseId() {
  const output = run(["wrangler", "d1", "list", "--json"]);
  const databases = JSON.parse(output);
  const match = databases.find((db) => db.name === DB_NAME);
  return match ? match.uuid : null;
}

function createDatabase() {
  const output = run(["wrangler", "d1", "create", DB_NAME]);
  const match = output.match(/"database_id"\s*:\s*"([0-9a-f-]+)"/i);
  if (!match) {
    throw new Error(`Could not parse a database_id out of "wrangler d1 create ${DB_NAME}" output:\n${output}`);
  }
  return match[1];
}

function updateConfig(databaseId) {
  const configText = readFileSync(CONFIG_PATH, "utf8");
  const pattern = new RegExp(
    `("database_name"\\s*:\\s*"${DB_NAME}"[\\s\\S]*?"database_id"\\s*:\\s*")[0-9a-f-]*(")`,
    "i"
  );

  if (!pattern.test(configText)) {
    throw new Error(`Could not find a "database_name": "${DB_NAME}" entry in wrangler.jsonc to update.`);
  }

  const updated = configText.replace(pattern, `$1${databaseId}$2`);
  if (updated === configText) {
    console.log(`[ensure-d1] wrangler.jsonc already has the correct database_id (${databaseId}).`);
    return;
  }

  writeFileSync(CONFIG_PATH, updated);
  console.log(`[ensure-d1] Updated wrangler.jsonc database_id to ${databaseId}.`);
}

function main() {
  console.log(`[ensure-d1] Resolving database_id for "${DB_NAME}"...`);

  let id = findExistingDatabaseId();
  if (id) {
    console.log(`[ensure-d1] Found existing database: ${id}`);
  } else {
    console.log(`[ensure-d1] No "${DB_NAME}" database found in this account — creating one...`);
    id = createDatabase();
    console.log(`[ensure-d1] Created database: ${id}`);
  }

  updateConfig(id);
}

main();
