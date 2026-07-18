import "../config/bootstrap.js";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFile } from "node:fs/promises";
import { loadBackup, createBackup } from "../backup/backup.js";
import { createDiscordClient, fetchGuild, login } from "../discord.js";
import { collectGuildSnapshot } from "../exporter.js";
import { withClientCleanup } from "../apply/engine.js";
import { DiscordWriter } from "../discord/writer.js";
import { buildRestoreOperations } from "./planner.js";
import { canonicalHash } from "../utils/canonicalJson.js";
import { orderOperations, SafetyError } from "../engine/planSafety.js";
import { confirmationPhrase, requireConfirmation } from "../engine/confirmation.js";
import { reportCliError } from "../utils/cliError.js";
import {
  getProfileIdentity,
  printProfileContext,
} from "../config/profileSelection.js";

async function main(): Promise<void> {
  const dryRunIndex = process.argv.indexOf("--dry-run");
  const backupIndex = process.argv.indexOf("--backup");
  const backupPath =
    dryRunIndex >= 0
      ? process.argv[dryRunIndex + 1]
      : backupIndex >= 0
        ? process.argv[backupIndex + 1]
        : undefined;
  if (!backupPath) throw new SafetyError("Provide --dry-run <backup-path> or --backup <path>.");
  const backup = await loadBackup(backupPath);
  const token = process.env.DISCORD_TOKEN;
  const guildId = process.env.GUILD_ID;
  if (!token || !guildId) throw new SafetyError("DISCORD_TOKEN and GUILD_ID are required.");
  if (guildId !== backup.manifest.guildId) throw new SafetyError("Restore guild mismatch.");

  const profile = await getProfileIdentity();
  printProfileContext(profile);
  console.log(dryRunIndex >= 0 ? "ONLINE READ-ONLY RESTORE DRY RUN" : "ONLINE GUARDED RESTORE");
  const client = createDiscordClient();
  await withClientCleanup(client, async () => {
    await login(client, token);
    const guild = await fetchGuild(client, guildId);
    const current = await collectGuildSnapshot(guild);
    const operations = buildRestoreOperations(backup.snapshot, current);
    operations.forEach((operation) =>
      console.log(`[${operation.action.toUpperCase()}] ${operation.label}`),
    );
    if (dryRunIndex >= 0) {
      console.log("Dry run complete. No Discord changes were made.");
      return;
    }
    if (operations.some((operation) => operation.ambiguous || !operation.supported)) {
      throw new SafetyError("Restore contains ambiguous or unsupported operations.");
    }
    const expected = confirmationPhrase("RESTORE", backup.manifest.guildName);
    const readline = createInterface({ input: stdin, output: stdout });
    let confirmation: string;
    try {
      confirmation = await readline.question(`Type exactly ${JSON.stringify(expected)}: `);
    } finally {
      readline.close();
    }
    requireConfirmation(confirmation, "RESTORE", backup.manifest.guildName);
    const packageMetadata = JSON.parse(await readFile("package.json", "utf8")) as {
      version: string;
    };
    await createBackup({
      snapshot: current,
      profileHash: backup.manifest.profileHash,
      planHash: canonicalHash(operations),
      appVersion: packageMetadata.version,
      reason: "pre-restore",
    });
    const writer = new DiscordWriter(guild);
    for (const operation of orderOperations(
      operations.filter((item) => item.action !== "warning"),
    )) {
      await writer.execute(operation);
    }
    console.log("Restore completed for supported existing resources. No resources were deleted.");
  });
}

if (require.main === module) {
  main().catch((error: unknown) => {
    reportCliError(error);
    process.exitCode = error instanceof SafetyError ? 2 : 1;
  });
}
