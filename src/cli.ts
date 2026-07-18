import { spawnSync } from "node:child_process";
import path from "node:path";
import "dotenv/config";
import { getProfileDirectory, getSelectedProfileName } from "./config/profileSelection.js";

const help = `Discord IaC CLI

Usage:
  npm run cli -- <command> [--profile <path>] [--snapshot <path>] [--plan <path>]

Offline: validate, audit, plan, diff, verify
Online read-only: export, drift
Online guarded writes: apply, restore

Commands:
  export    Read-only Discord snapshot export
  validate  Validate a desired profile
  audit     Audit a local snapshot
  plan      Print a concise offline plan
  diff      Print a detailed offline diff
  verify    Exit 1 when offline actionable differences remain
  drift     Compare live read-only state with a saved plan
  apply     Guarded apply; requires exact confirmation and backup
  restore   Conservative restore; supports --dry-run <backup-path>

Exit codes: 0 success, 1 actionable difference/runtime failure, 2 safety/configuration error.
Use --debug to preserve child diagnostic output.`;

function option(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
}

function main(): void {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "help") {
    console.log(help);
    return;
  }
  const selectedProfile = getSelectedProfileName();
  const profile = option(args, "--profile", getProfileDirectory(selectedProfile));
  const snapshot = option(args, "--snapshot", "exports");
  const plan = option(args, "--plan", `plans/${selectedProfile}.plan.json`);
  const entries: Record<string, { file: string; args: string[]; label: string }> = {
    export: { file: "src/index.ts", args: [], label: "ONLINE READ-ONLY" },
    validate: {
      file: "src/config/profileValidator.ts",
      args: [profile],
      label: "OFFLINE",
    },
    audit: { file: "src/planner/snapshotAudit.ts", args: [snapshot], label: "OFFLINE" },
    plan: { file: "src/planner/plan.ts", args: [profile, snapshot], label: "OFFLINE" },
    diff: { file: "src/planner/diff.ts", args: [profile, snapshot], label: "OFFLINE" },
    verify: { file: "src/engine/verify.ts", args: [profile, snapshot], label: "OFFLINE" },
    drift: {
      file: "src/engine/driftCli.ts",
      args: ["--plan", plan],
      label: "ONLINE READ-ONLY",
    },
    apply: {
      file: "src/apply/apply.ts",
      args: ["--plan", plan, "--profile", profile],
      label: "ONLINE GUARDED WRITE",
    },
    restore: {
      file: "src/restore/restore.ts",
      args: args.filter((arg) => arg !== "--debug"),
      label: "ONLINE GUARDED WRITE",
    },
  };
  const entry = entries[command];
  if (!entry) {
    console.error(`Unknown command: ${command}\n\n${help}`);
    process.exitCode = 2;
    return;
  }
  console.log(`${entry.label}: ${command}`);
  const tsxCli = path.resolve("node_modules", "tsx", "dist", "cli.mjs");
  const result = spawnSync(process.execPath, [tsxCli, entry.file, ...entry.args], {
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      DISCORD_IAC_DEBUG: args.includes("--debug") ? "1" : "0",
    },
  });
  if (result.error) {
    console.error(`Could not start ${command}: ${result.error.message}`);
    process.exitCode = 2;
    return;
  }
  process.exitCode = result.status ?? 1;
}

main();
