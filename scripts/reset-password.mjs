#!/usr/bin/env node
// Resets the imghost admin password directly in D1, for when you're locked out and
// have no other recovery path (this is a single-account app with no "forgot password"
// email flow by design — see README's Account recovery section for why).
//
// Usage:
//   npm run reset-password             # resets the deployed (remote) database
//   npm run reset-password -- --local  # resets the local `wrangler dev` database
//
// Note: input is not masked (it's echoed to the terminal as you type/paste it) — this
// keeps the prompt logic simple and correct for both typed and pasted input. Run it in
// a private terminal.

import { randomBytes, pbkdf2Sync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";

// Must match PBKDF2_ITERATIONS in src/auth.ts — if that changes, update this too.
const PBKDF2_ITERATIONS = 100_000;
const DB_NAME = "imghost-db";

// A plain rl.question()/rl.question() pair can silently drop the second answer when
// input isn't a live TTY (e.g. piped): readline emits 'line' as soon as it parses one,
// and if no question() is actively listening yet, that line is lost rather than queued.
// This queues every line as it arrives, so nothing is ever dropped regardless of timing.
function makePrompter() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const queue = [];
  const waiters = [];
  rl.on("line", (line) => {
    if (waiters.length) waiters.shift()(line);
    else queue.push(line);
  });
  rl.on("close", () => {
    while (waiters.length) waiters.shift()(null);
  });
  return {
    ask(promptText) {
      process.stdout.write(promptText);
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve) => waiters.push(resolve));
    },
    close() {
      rl.close();
    },
  };
}

function runD1(local, sql) {
  const args = ["wrangler", "d1", "execute", DB_NAME, local ? "--local" : "--remote", "--json", "--command", sql];
  const output = execFileSync("npx", args, { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] });
  return JSON.parse(output);
}

async function main() {
  const local = process.argv.includes("--local");

  console.log(`Resetting the imghost admin password (${local ? "local dev" : "remote/production"} database: ${DB_NAME}).`);

  let countResult;
  try {
    countResult = runD1(local, "SELECT COUNT(*) as count FROM account;");
  } catch (err) {
    console.error("wrangler d1 execute failed:", err.message);
    process.exit(1);
  }
  const accountCount = countResult?.[0]?.results?.[0]?.count ?? 0;
  if (accountCount === 0) {
    console.error(
      "No admin account exists yet in that database — visit the app's URL to run first-time " +
        "setup instead of resetting a password."
    );
    process.exit(1);
  }

  const prompter = makePrompter();
  const password = await prompter.ask("New password (min 8 chars): ");
  const confirm = await prompter.ask("Confirm password: ");
  prompter.close();

  if (password === null || confirm === null) {
    console.error("\nNo input received (stdin closed) — nothing was changed.");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }
  if (password !== confirm) {
    console.error("Passwords don't match — nothing was changed.");
    process.exit(1);
  }

  const saltBytes = randomBytes(16);
  const derived = pbkdf2Sync(password, saltBytes, PBKDF2_ITERATIONS, 32, "sha256");
  const hash = derived.toString("hex");
  const salt = saltBytes.toString("hex");

  // hash/salt are our own hex output (0-9a-f only) — safe to inline, nothing to escape.
  const sql = `UPDATE account SET password_hash = '${hash}', salt = '${salt}';`;

  console.log(`\nUpdating the account row in ${local ? "the local dev" : "your deployed"} database...`);

  let updateResult;
  try {
    updateResult = runD1(local, sql);
  } catch (err) {
    console.error("\nwrangler d1 execute failed:", err.message);
    process.exit(1);
  }

  if (updateResult?.[0]?.success !== true) {
    console.error("\nUnexpected response from wrangler — check above for errors before assuming this worked.");
    process.exit(1);
  }

  console.log("\nDone — password reset. Log in with the new password now.");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
