import { initializeProfileFromSnapshot } from "./profileInitializer.js";
import { reportCliError } from "../utils/cliError.js";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const profileName = option("--profile");
  const sourceDirectory = option("--source");
  if (!profileName || !sourceDirectory) {
    throw new Error("Usage: npm run profile:init -- --profile <key> --source <snapshot-directory>");
  }
  const result = await initializeProfileFromSnapshot({ profileName, sourceDirectory });
  console.log(`Desired profile initialized: ${result.directory}`);
  console.log(`Raw snapshot preserved: ${result.archivedSnapshot}`);
  result.warnings.forEach((warning) => console.log(`WARNING: ${warning}`));
}

main().catch((error: unknown) => {
  reportCliError(error);
  process.exitCode = 2;
});
