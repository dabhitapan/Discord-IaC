import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  DesiredCategory,
  DesiredChannel,
  DesiredProfile,
  DesiredRole,
  PermissionRule,
  ProfileMetadata,
} from "../planner/types.js";

async function readJson<T>(directory: string, fileName: string): Promise<T> {
  const filePath = path.join(directory, fileName);

  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    throw new Error(`Could not load profile file ${filePath}.`, { cause: error });
  }
}

export async function loadProfile(profileDirectory: string): Promise<DesiredProfile> {
  const directory = path.resolve(profileDirectory);
  const [metadata, roles, categories, channels, permissionRules] =
    await Promise.all([
      readJson<ProfileMetadata>(directory, "profile.json"),
      readJson<DesiredRole[]>(directory, "roles.json"),
      readJson<DesiredCategory[]>(directory, "categories.json"),
      readJson<DesiredChannel[]>(directory, "channels.json"),
      readJson<PermissionRule[]>(directory, "permission-rules.json"),
    ]);

  return { metadata, roles, categories, channels, permissionRules };
}
