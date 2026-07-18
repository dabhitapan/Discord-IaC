import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ChannelType,
  OverwriteType,
  type Guild,
  type NonThreadGuildBasedChannel,
  type PermissionOverwrites,
} from "discord.js";
import type {
  CategoryExport,
  ChannelExport,
  ExportSummary,
  ForumTagExport,
  PermissionOverwriteExport,
  RoleExport,
  ServerExport,
} from "./types.js";
import type { LiveSnapshot } from "./planner/types.js";

const OUTPUT_DIRECTORY = path.resolve(process.cwd(), "exports");

function permissionNames(names: readonly string[]): string[] {
  return [...names].sort((a, b) => a.localeCompare(b));
}

function serializeOverwrite(
  channel: NonThreadGuildBasedChannel,
  overwrite: PermissionOverwrites,
): PermissionOverwriteExport {
  return {
    channelId: channel.id,
    channelName: channel.name,
    targetId: overwrite.id,
    targetType: overwrite.type === OverwriteType.Role ? "role" : "member",
    allow: permissionNames(overwrite.allow.toArray()),
    deny: permissionNames(overwrite.deny.toArray()),
  };
}

function serializeForumTag(tag: {
  id: string;
  name: string;
  moderated: boolean;
  emoji: { id: string | null; name: string | null } | null;
}): ForumTagExport {
  return {
    id: tag.id,
    name: tag.name,
    moderated: tag.moderated,
    emoji: tag.emoji ? { id: tag.emoji.id, name: tag.emoji.name } : null,
  };
}

function serializeChannel(channel: NonThreadGuildBasedChannel): ChannelExport {
  const exported: ChannelExport = {
    id: channel.id,
    name: channel.name,
    type: ChannelType[channel.type],
    parentId: channel.parentId,
    position: channel.position,
    permissionsLocked: channel.permissionsLocked,
  };

  if (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement ||
    channel.type === ChannelType.GuildForum ||
    channel.type === ChannelType.GuildMedia
  ) {
    exported.topic = channel.topic;
    exported.nsfw = channel.nsfw;
    exported.rateLimitPerUser = channel.rateLimitPerUser;
  }

  if (
    channel.type === ChannelType.GuildVoice ||
    channel.type === ChannelType.GuildStageVoice
  ) {
    exported.bitrate = channel.bitrate;
    exported.userLimit = channel.userLimit;
  }

  if (channel.type === ChannelType.GuildForum) {
    exported.availableTags = channel.availableTags.map(serializeForumTag);
    exported.defaultReactionEmoji = channel.defaultReactionEmoji
      ? {
          id: channel.defaultReactionEmoji.id,
          name: channel.defaultReactionEmoji.name,
        }
      : null;
  }

  return exported;
}

function compareByPositionThenId(
  a: { position: number; id: string },
  b: { position: number; id: string },
): number {
  return a.position - b.position || a.id.localeCompare(b.id);
}

async function writeJson(fileName: string, value: unknown): Promise<void> {
  await writeFile(
    path.join(OUTPUT_DIRECTORY, fileName),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

export async function collectGuildSnapshot(guild: Guild): Promise<LiveSnapshot> {
  const [rolesCollection, channelsCollection] = await Promise.all([
    guild.roles.fetch(),
    guild.channels.fetch(),
  ]);

  const allChannels = [...channelsCollection.values()].filter(
    (channel): channel is NonThreadGuildBasedChannel => channel !== null,
  );
  const categoryChannels = allChannels
    .filter((channel) => channel.type === ChannelType.GuildCategory)
    .sort(compareByPositionThenId);
  const categoryPositions = new Map(
    categoryChannels.map((category) => [category.id, category.position]),
  );

  const roles: RoleExport[] = [...rolesCollection.values()]
    .sort((a, b) => b.position - a.position || a.id.localeCompare(b.id))
    .map((role) => ({
      id: role.id,
      name: role.name,
      color: role.color,
      position: role.position,
      hoist: role.hoist,
      mentionable: role.mentionable,
      managed: role.managed,
      permissions: permissionNames(role.permissions.toArray()),
    }));

  const categories: CategoryExport[] = categoryChannels.map((category) => ({
    id: category.id,
    name: category.name,
    position: category.position,
    permissionOverwrites: [...category.permissionOverwrites.cache.values()]
      .map((overwrite) => serializeOverwrite(category, overwrite))
      .sort((a, b) => a.targetId.localeCompare(b.targetId))
      .map(({ channelId: _channelId, channelName: _channelName, ...overwrite }) =>
        overwrite,
      ),
  }));

  const nonCategoryChannels = allChannels.filter(
    (channel) => channel.type !== ChannelType.GuildCategory,
  );
  const channels: ChannelExport[] = nonCategoryChannels
    .sort((a, b) => {
      const aCategoryPosition = a.parentId
        ? (categoryPositions.get(a.parentId) ?? Number.MAX_SAFE_INTEGER - 1)
        : Number.MAX_SAFE_INTEGER;
      const bCategoryPosition = b.parentId
        ? (categoryPositions.get(b.parentId) ?? Number.MAX_SAFE_INTEGER - 1)
        : Number.MAX_SAFE_INTEGER;

      return (
        aCategoryPosition - bCategoryPosition ||
        a.position - b.position ||
        a.id.localeCompare(b.id)
      );
    })
    .map(serializeChannel);

  const permissionOverwrites: PermissionOverwriteExport[] = allChannels
    .flatMap((channel) =>
      [...channel.permissionOverwrites.cache.values()].map((overwrite) =>
        serializeOverwrite(channel, overwrite),
      ),
    )
    .sort(
      (a, b) =>
        a.channelId.localeCompare(b.channelId) ||
        a.targetId.localeCompare(b.targetId),
    );

  const server: ServerExport = {
    id: guild.id,
    name: guild.name,
    description: guild.description,
    verificationLevel: guild.verificationLevel,
    explicitContentFilter: guild.explicitContentFilter,
    defaultMessageNotifications: guild.defaultMessageNotifications,
    preferredLocale: guild.preferredLocale,
    features: [...guild.features].sort((a, b) => a.localeCompare(b)),
  };

  return { server, roles, categories, channels, permissionOverwrites };
}

export async function exportGuild(guild: Guild): Promise<ExportSummary> {
  const snapshot = await collectGuildSnapshot(guild);
  try {
    await mkdir(OUTPUT_DIRECTORY, { recursive: true });
    await Promise.all([
      writeJson("server.json", snapshot.server),
      writeJson("roles.json", snapshot.roles),
      writeJson("categories.json", snapshot.categories),
      writeJson("channels.json", snapshot.channels),
      writeJson("permission-overwrites.json", snapshot.permissionOverwrites),
    ]);
  } catch (error) {
    throw new Error(`Could not write export files to ${OUTPUT_DIRECTORY}.`, {
      cause: error,
    });
  }

  return {
    outputDirectory: OUTPUT_DIRECTORY,
    roles: snapshot.roles.length,
    categories: snapshot.categories.length,
    channels: snapshot.channels.length,
    permissionOverwrites: snapshot.permissionOverwrites.length,
  };
}
