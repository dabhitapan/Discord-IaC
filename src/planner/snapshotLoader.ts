import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LiveSnapshot } from "./types.js";

async function readSnapshotFile<T>(directory: string, fileName: string): Promise<T> {
  const filePath = path.join(directory, fileName);
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    throw new Error(`Could not load snapshot file ${filePath}.`, { cause: error });
  }
}

export async function loadSnapshot(exportsDirectory: string): Promise<LiveSnapshot> {
  const directory = path.resolve(exportsDirectory);
  const [server, roles, categories, channels, permissionOverwrites] = await Promise.all([
    readSnapshotFile<LiveSnapshot["server"]>(directory, "server.json"),
    readSnapshotFile<LiveSnapshot["roles"]>(directory, "roles.json"),
    readSnapshotFile<LiveSnapshot["categories"]>(directory, "categories.json"),
    readSnapshotFile<LiveSnapshot["channels"]>(directory, "channels.json"),
    readSnapshotFile<LiveSnapshot["permissionOverwrites"]>(
      directory,
      "permission-overwrites.json",
    ),
  ]);
  return { server, roles, categories, channels, permissionOverwrites };
}
