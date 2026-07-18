import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { prettyCanonicalJson } from "../utils/canonicalJson.js";
import type {
  DesiredCategory,
  DesiredChannel,
  DesiredRole,
  LiveSnapshot,
  PermissionRule,
} from "../planner/types.js";

const snapshotFiles = [
  "server.json",
  "roles.json",
  "categories.json",
  "channels.json",
  "permission-overwrites.json",
] as const;

function logicalKey(name: string, used: Set<string>): string {
  const base =
    name
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "resource";
  let key = base;
  let suffix = 2;
  while (used.has(key)) key = `${base}-${suffix++}`;
  used.add(key);
  return key;
}

async function readJson<T>(directory: string, file: string): Promise<T> {
  return JSON.parse(await readFile(path.join(directory, file), "utf8")) as T;
}

export async function initializeProfileFromSnapshot(options: {
  sourceDirectory: string;
  profileName: string;
  projectDirectory?: string;
}): Promise<{ directory: string; archivedSnapshot: string; warnings: string[] }> {
  const projectDirectory = path.resolve(options.projectDirectory ?? process.cwd());
  const sourceDirectory = path.resolve(options.sourceDirectory);
  const directory = path.join(projectDirectory, "profiles", options.profileName);
  const archivedSnapshot = path.join(projectDirectory, "exports", options.profileName);
  const [server, roles, categories, channels, permissionOverwrites] = await Promise.all([
    readJson<LiveSnapshot["server"]>(sourceDirectory, "server.json"),
    readJson<LiveSnapshot["roles"]>(sourceDirectory, "roles.json"),
    readJson<LiveSnapshot["categories"]>(sourceDirectory, "categories.json"),
    readJson<LiveSnapshot["channels"]>(sourceDirectory, "channels.json"),
    readJson<LiveSnapshot["permissionOverwrites"]>(
      sourceDirectory,
      "permission-overwrites.json",
    ),
  ]);
  await mkdir(archivedSnapshot, { recursive: true });
  await Promise.all(
    snapshotFiles.map((file) => copyFile(path.join(sourceDirectory, file), path.join(archivedSnapshot, file))),
  );
  await mkdir(directory, { recursive: true });

  const roleKeys = new Set<string>();
  const desiredRoles: DesiredRole[] = roles
    .filter((role) => !role.managed && role.name !== "@everyone")
    .map((role) => ({
      key: logicalKey(role.name, roleKeys),
      name: role.name,
      permissions: role.permissions,
      deniedPermissions: [],
      color: role.color,
      hoist: role.hoist,
      mentionable: role.mentionable,
    }));
  const roleKeyById = new Map(
    desiredRoles.map((desired) => [roles.find((role) => role.name === desired.name)?.id, desired.key]),
  );
  const everyoneId = roles.find((role) => role.name === "@everyone")?.id;

  const categoryKeys = new Set<string>();
  const desiredCategories: DesiredCategory[] = categories.map((category) => ({
    key: logicalKey(category.name, categoryKeys),
    name: category.name,
  }));
  const categoryKeyById = new Map(
    categories.map((category, index) => [category.id, desiredCategories[index].key]),
  );
  const channelKeys = new Set<string>();
  const includedChannels = channels.filter(
    (channel) => channel.parentId && categoryKeyById.has(channel.parentId),
  );
  const desiredChannels: DesiredChannel[] = includedChannels.map((channel) => ({
    key: logicalKey(channel.name, channelKeys),
    name: channel.name,
    type: channel.type as DesiredChannel["type"],
    categoryKey: categoryKeyById.get(channel.parentId!)!,
    ...(channel.permissionsLocked === true ? { permissionMode: "inherit" as const } : {}),
    ...(channel.topic !== undefined ? { topic: channel.topic } : {}),
    ...(channel.nsfw !== undefined ? { nsfw: channel.nsfw } : {}),
    ...(channel.rateLimitPerUser !== undefined
      ? { rateLimitPerUser: channel.rateLimitPerUser }
      : {}),
    ...(channel.bitrate !== undefined ? { bitrate: channel.bitrate } : {}),
    ...(channel.userLimit !== undefined ? { userLimit: channel.userLimit } : {}),
    ...(channel.availableTags !== undefined ? { availableTags: channel.availableTags } : {}),
    ...(channel.defaultReactionEmoji !== undefined
      ? { defaultReactionEmoji: channel.defaultReactionEmoji }
      : {}),
  }));
  const channelKeyById = new Map(
    includedChannels.map((channel, index) => [channel.id, desiredChannels[index].key]),
  );
  const rules: PermissionRule[] = [];
  const warnings: string[] = [];
  for (const overwrite of permissionOverwrites) {
    const categoryKey = categoryKeyById.get(overwrite.channelId);
    const channelKey = channelKeyById.get(overwrite.channelId);
    const target =
      overwrite.targetType === "role" && overwrite.targetId === everyoneId
        ? ({ type: "everyone" } as const)
        : roleKeyById.get(overwrite.targetId)
          ? ({ type: "role", roleKey: roleKeyById.get(overwrite.targetId)! } as const)
          : undefined;
    if ((!categoryKey && !channelKey) || !target) {
      warnings.push(
        `Skipped overwrite ${overwrite.channelName} → ${overwrite.targetId}; it is unmanaged or member-specific.`,
      );
      continue;
    }
    if (channelKey) {
      const channel = desiredChannels.find((item) => item.key === channelKey);
      if (channel?.permissionMode === "inherit") {
        warnings.push(`Skipped redundant inherited overwrite for channel ${channel.name}.`);
        continue;
      }
    }
    const scope = categoryKey
      ? ({ type: "category", key: categoryKey } as const)
      : ({ type: "channel", key: channelKey! } as const);
    const targetKey = target.type === "everyone" ? "everyone" : target.roleKey;
    rules.push({
      key: `${scope.key}-${targetKey}`,
      scope,
      target,
      allow: overwrite.allow,
      deny: overwrite.deny,
    });
  }

  await Promise.all([
    writeFile(
      path.join(directory, "profile.json"),
      prettyCanonicalJson({ key: options.profileName, name: server.name, version: 1 }),
    ),
    writeFile(path.join(directory, "roles.json"), prettyCanonicalJson(desiredRoles)),
    writeFile(path.join(directory, "categories.json"), prettyCanonicalJson(desiredCategories)),
    writeFile(path.join(directory, "channels.json"), prettyCanonicalJson(desiredChannels)),
    writeFile(path.join(directory, "permission-rules.json"), prettyCanonicalJson(rules)),
  ]);
  if (sourceDirectory === directory) {
    await Promise.all([
      rm(path.join(directory, "server.json")),
      rm(path.join(directory, "permission-overwrites.json")),
    ]);
  }
  return { directory, archivedSnapshot, warnings };
}
