import {
  ChannelType,
  type Client,
  type NonThreadGuildBasedChannel,
} from "discord.js";
import { createDiscordClient, fetchGuild, login } from "../discord.js";
import type {
  LiveContentChannelType,
  ReadOnlyDiscordGateway,
  ReadOnlyLiveGuild,
} from "./verificationTypes.js";

function liveChannelType(type: ChannelType): LiveContentChannelType {
  switch (type) {
    case ChannelType.GuildText:
      return "text";
    case ChannelType.GuildAnnouncement:
      return "announcement";
    case ChannelType.GuildForum:
    case ChannelType.GuildMedia:
      return "forum";
    case ChannelType.GuildVoice:
    case ChannelType.GuildStageVoice:
      return "voice";
    case ChannelType.GuildCategory:
      return "category";
    default:
      return "other";
  }
}

function compareById(left: { id: string }, right: { id: string }): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export class DiscordJsReadOnlyContentGateway implements ReadOnlyDiscordGateway {
  readonly #client: Client;

  constructor(client = createDiscordClient()) {
    this.#client = client;
  }

  async connect(token: string): Promise<void> {
    await login(this.#client, token);
  }

  async fetchGuild(guildId: string): Promise<ReadOnlyLiveGuild> {
    const guild = await fetchGuild(this.#client, guildId);
    const fetched = await guild.channels.fetch();
    const channels = [...fetched.values()]
      .filter((channel): channel is NonThreadGuildBasedChannel => channel !== null)
      .sort(compareById);
    return {
      id: guild.id,
      name: guild.name,
      categories: channels
        .filter((channel) => channel.type === ChannelType.GuildCategory)
        .map((category) => ({ id: category.id, name: category.name })),
      channels: channels
        .filter((channel) => channel.type !== ChannelType.GuildCategory)
        .map((channel) => ({
          id: channel.id,
          name: channel.name,
          type: liveChannelType(channel.type),
          parentId: channel.parentId,
        })),
    };
  }

  disconnect(): void {
    this.#client.destroy();
  }
}
