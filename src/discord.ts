import { Client, Events, GatewayIntentBits, type Guild } from "discord.js";

export function createDiscordClient(): Client {
  return new Client({ intents: [GatewayIntentBits.Guilds] });
}

export async function login(client: Client, token: string): Promise<string> {
  const ready = new Promise<void>((resolve) => {
    client.once(Events.ClientReady, () => resolve());
  });

  try {
    await client.login(token);
    await ready;
  } catch (error) {
    throw new Error("Discord login failed. Check that DISCORD_TOKEN is valid.", {
      cause: error,
    });
  }

  if (!client.user) {
    throw new Error("Discord connected, but no bot user was available.");
  }

  return client.user.tag;
}

export async function fetchGuild(client: Client, guildId: string): Promise<Guild> {
  try {
    return await client.guilds.fetch({ guild: guildId, force: true });
  } catch (error) {
    throw new Error(
      `Could not access guild ${guildId}. Check GUILD_ID and ensure the bot belongs to the server.`,
      { cause: error },
    );
  }
}
