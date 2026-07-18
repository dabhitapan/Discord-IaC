import { createDiscordClient, fetchGuild, login } from "../discord.js";
import { collectGuildSnapshot } from "../exporter.js";
import { loadPlanDocument } from "../planner/artifact.js";
import { withClientCleanup } from "../apply/engine.js";
import { detectDrift } from "./drift.js";
import { SafetyError } from "./planSafety.js";
import { reportCliError } from "../utils/cliError.js";
import {
  getProfileIdentity,
  printProfileContext,
} from "../config/profileSelection.js";

async function main(): Promise<void> {
  await import("dotenv/config");
  const planIndex = process.argv.indexOf("--plan");
  const plan = await loadPlanDocument(
    planIndex >= 0 ? (process.argv[planIndex + 1] ?? "") : "plans/wao-noobs.plan.json",
  );
  const token = process.env.DISCORD_TOKEN;
  const guildId = process.env.GUILD_ID;
  if (!token || !guildId) throw new SafetyError("DISCORD_TOKEN and GUILD_ID are required.");
  const profile = await getProfileIdentity();
  printProfileContext(profile);
  console.log("ONLINE READ-ONLY DRIFT CHECK");
  const client = createDiscordClient();
  const result = await withClientCleanup(client, async () => {
    await login(client, token);
    const guild = await fetchGuild(client, guildId);
    return detectDrift(plan, await collectGuildSnapshot(guild));
  });
  console.log(result.drifted ? "Actionable drift detected." : "No drift detected.");
  process.exitCode = result.drifted ? 1 : 0;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    reportCliError(error);
    process.exitCode = error instanceof SafetyError ? 2 : 1;
  });
}
