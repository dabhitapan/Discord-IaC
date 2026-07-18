import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_PROFILE = "wao-noobs";

export function getSelectedProfileName(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const selected = environment.PROFILE?.trim() || DEFAULT_PROFILE;
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(selected)) {
    throw new Error(`Invalid PROFILE value ${JSON.stringify(selected)}.`);
  }
  return selected;
}

export function getProfileDirectory(
  profileName = getSelectedProfileName(),
  projectDirectory = process.cwd(),
): string {
  const directory = path.resolve(projectDirectory, "profiles", profileName);
  if (!existsSync(directory)) {
    throw new Error(
      `Profile ${JSON.stringify(profileName)} does not exist.\nExpected:\nprofiles/${profileName}/`,
    );
  }
  return directory;
}

export async function getProfileIdentity(
  profileName = getSelectedProfileName(),
): Promise<{ key: string; name: string; directory: string }> {
  const directory = getProfileDirectory(profileName);
  try {
    const metadata = JSON.parse(
      await readFile(path.join(directory, "profile.json"), "utf8"),
    ) as { key?: string; name?: string };
    if (!metadata.key || !metadata.name) throw new Error("Missing key or name.");
    return { key: metadata.key, name: metadata.name, directory };
  } catch (error) {
    throw new Error(`Profile ${JSON.stringify(profileName)} has invalid profile.json.`, {
      cause: error,
    });
  }
}

export function printProfileContext(identity: {
  key: string;
  name: string;
  directory: string;
}): void {
  console.log("------------------------------------");
  console.log(`Profile: ${identity.key}`);
  console.log("Profile Directory:");
  console.log(identity.directory);
  console.log("\nGuild:");
  console.log(identity.name);
  console.log("\n------------------------------------");
}
