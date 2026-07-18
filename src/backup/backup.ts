import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LiveSnapshot } from "../planner/types.js";
import { canonicalHash, prettyCanonicalJson } from "../utils/canonicalJson.js";

export interface BackupManifest {
  schemaVersion: 1;
  guildId: string;
  guildName: string;
  sourceSnapshotHash: string;
  profileHash: string;
  planHash: string;
  appVersion: string;
  backupReason: string;
  createdAt: string;
}

export interface LoadedBackup {
  directory: string;
  manifest: BackupManifest;
  snapshot: LiveSnapshot;
}

export async function createBackup(options: {
  rootDirectory?: string;
  snapshot: LiveSnapshot;
  profileHash: string;
  planHash: string;
  appVersion: string;
  reason: string;
  now?: Date;
}): Promise<string> {
  const now = options.now ?? new Date();
  const safeTimestamp = now.toISOString().replace(/[:.]/g, "-");
  const backupId = `${safeTimestamp}-${canonicalHash(options.snapshot).slice(0, 12)}`;
  const guildDirectory = path.resolve(
    options.rootDirectory ?? "backups",
    options.snapshot.server.id,
  );
  const directory = path.join(guildDirectory, backupId);
  await mkdir(guildDirectory, { recursive: true });
  await mkdir(directory);

  const manifest: BackupManifest = {
    schemaVersion: 1,
    guildId: options.snapshot.server.id,
    guildName: options.snapshot.server.name,
    sourceSnapshotHash: canonicalHash(options.snapshot),
    profileHash: options.profileHash,
    planHash: options.planHash,
    appVersion: options.appVersion,
    backupReason: options.reason,
    createdAt: now.toISOString(),
  };
  await Promise.all([
    writeFile(path.join(directory, "server.json"), prettyCanonicalJson(options.snapshot.server)),
    writeFile(path.join(directory, "roles.json"), prettyCanonicalJson(options.snapshot.roles)),
    writeFile(
      path.join(directory, "categories.json"),
      prettyCanonicalJson(options.snapshot.categories),
    ),
    writeFile(path.join(directory, "channels.json"), prettyCanonicalJson(options.snapshot.channels)),
    writeFile(
      path.join(directory, "permission-overwrites.json"),
      prettyCanonicalJson(options.snapshot.permissionOverwrites),
    ),
    writeFile(path.join(directory, "manifest.json"), prettyCanonicalJson(manifest)),
  ]);
  return directory;
}

async function readJson<T>(directory: string, file: string): Promise<T> {
  return JSON.parse(await readFile(path.join(directory, file), "utf8")) as T;
}

export async function loadBackup(directoryPath: string): Promise<LoadedBackup> {
  const directory = path.resolve(directoryPath);
  const [manifest, server, roles, categories, channels, permissionOverwrites] =
    await Promise.all([
      readJson<BackupManifest>(directory, "manifest.json"),
      readJson<LiveSnapshot["server"]>(directory, "server.json"),
      readJson<LiveSnapshot["roles"]>(directory, "roles.json"),
      readJson<LiveSnapshot["categories"]>(directory, "categories.json"),
      readJson<LiveSnapshot["channels"]>(directory, "channels.json"),
      readJson<LiveSnapshot["permissionOverwrites"]>(
        directory,
        "permission-overwrites.json",
      ),
    ]);
  const snapshot = { server, roles, categories, channels, permissionOverwrites };
  if (manifest.guildId !== server.id || manifest.sourceSnapshotHash !== canonicalHash(snapshot)) {
    throw new SafetyError("Backup identity or snapshot hash is invalid.");
  }
  return { directory, manifest, snapshot };
}

import { SafetyError } from "../engine/planSafety.js";
