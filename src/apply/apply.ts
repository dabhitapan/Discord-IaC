import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFile } from "node:fs/promises";
import { createDiscordClient, fetchGuild, login } from "../discord.js";
import { collectGuildSnapshot, exportGuild } from "../exporter.js";
import { loadProfile } from "../config/profileLoader.js";
import { validateProfile } from "../config/profileValidator.js";
import { loadPlanDocument } from "../planner/artifact.js";
import { createBackup } from "../backup/backup.js";
import { DiscordWriter } from "../discord/writer.js";
import { executeGuardedPlan, withClientCleanup } from "./engine.js";
import { canonicalHash } from "../utils/canonicalJson.js";
import { SafetyError } from "../engine/planSafety.js";
import { reportCliError } from "../utils/cliError.js";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

async function main(): Promise<void> {
  await import("dotenv/config");
  const planPath = argument("--plan", "plans/wao-noobs.plan.json");
  const profilePath = argument("--profile", "profiles/wao-noobs");
  const profile = await loadProfile(profilePath);
  const validationErrors = validateProfile(profile);
  if (validationErrors.length > 0) {
    throw new SafetyError(`Profile validation failed: ${validationErrors.join("; ")}`);
  }
  const plan = await loadPlanDocument(planPath);
  const token = process.env.DISCORD_TOKEN;
  const guildId = process.env.GUILD_ID;
  if (!token || !guildId) throw new SafetyError("DISCORD_TOKEN and GUILD_ID are required.");

  console.log("ONLINE GUARDED APPLY — Discord writes are possible after confirmation.");
  console.log(JSON.stringify(plan.summary, null, 2));
  plan.warnings.forEach((warning) => console.log(`WARNING: ${warning.label}`));

  const client = createDiscordClient();
  const result = await withClientCleanup(client, async () => {
    await login(client, token);
    const guild = await fetchGuild(client, guildId);
    const writer = new DiscordWriter(guild);
    return executeGuardedPlan(profile, plan, {
      getFreshSnapshot: () => collectGuildSnapshot(guild),
      requestConfirmation: async (expected) => {
        const readline = createInterface({ input: stdin, output: stdout });
        try {
          return await readline.question(`Type exactly ${JSON.stringify(expected)}: `);
        } finally {
          readline.close();
        }
      },
      createBackup: async (snapshot, planHash) => {
        const packageMetadata = JSON.parse(await readFile("package.json", "utf8")) as {
          version: string;
        };
        return createBackup({
          snapshot,
          profileHash: canonicalHash(profile),
          planHash,
          appVersion: packageMetadata.version,
          reason: "pre-apply",
        });
      },
      execute: (operation) => writer.execute(operation),
      getPostApplySnapshot: async () => {
        await exportGuild(guild);
        return collectGuildSnapshot(guild);
      },
    });
  });
  console.log(
    result.status === "noop"
      ? "Apply is already converged; no writes were needed."
      : `Apply succeeded with ${result.executed} verified operations. Backup: ${result.backupDirectory}`,
  );
}

if (require.main === module) {
  main().catch((error: unknown) => {
    reportCliError(error);
    process.exitCode = error instanceof SafetyError ? 2 : 1;
  });
}
