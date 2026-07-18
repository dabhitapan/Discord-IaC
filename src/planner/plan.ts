import path from "node:path";
import { loadProfile } from "../config/profileLoader.js";
import { validateProfile } from "../config/profileValidator.js";
import { formatPlan } from "./formatter.js";
import { buildPlan } from "./resolver.js";
import { loadSnapshot } from "./snapshotLoader.js";
import { reportCliError } from "../utils/cliError.js";
import { getProfileDirectory } from "../config/profileSelection.js";

async function main(): Promise<void> {
  await import("dotenv/config");
  const profileDirectory = process.argv[2] ?? getProfileDirectory();
  const exportsDirectory = process.argv[3] ?? "exports";
  const profile = await loadProfile(profileDirectory);
  const errors = validateProfile(profile);
  if (errors.length > 0) {
    throw new Error(`Profile is invalid:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }

  const snapshot = await loadSnapshot(exportsDirectory);
  console.log(`Offline plan for: ${profile.metadata.name}`);
  console.log(`Snapshot directory: ${path.resolve(exportsDirectory)}`);
  formatPlan(buildPlan(profile, snapshot));
}

main().catch((error: unknown) => {
  reportCliError(error);
  console.error("No Discord changes were made.");
  process.exitCode = 1;
});
