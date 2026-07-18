import "./config/bootstrap.js";
import { createDiscordClient, fetchGuild, login } from "./discord.js";
import { exportGuild } from "./exporter.js";
import { logError, logExportSummary } from "./logger.js";
import {
  getProfileIdentity,
  printProfileContext,
} from "./config/profileSelection.js";

function requireEnvironmentVariable(name: "DISCORD_TOKEN" | "GUILD_ID"): string {
  const value = process.env[name];

  if (!value?.trim()) {
    throw new Error(`${name} is missing. Add it to .env and try again.`);
  }

  return value;
}

async function main(): Promise<void> {
  const token = requireEnvironmentVariable("DISCORD_TOKEN");
  const guildId = requireEnvironmentVariable("GUILD_ID");
  const profile = await getProfileIdentity();
  const client = createDiscordClient();

  try {
    printProfileContext(profile);
    const botTag = await login(client, token);
    console.log(`Connected bot: ${botTag}`);

    const guild = await fetchGuild(client, guildId);
    console.log(`Server: ${guild.name}`);

    const summary = await exportGuild(guild);
    logExportSummary(summary);
  } finally {
    client.destroy();
  }
}

main().catch((error: unknown) => {
  logError(error);
  process.exitCode = 1;
});
