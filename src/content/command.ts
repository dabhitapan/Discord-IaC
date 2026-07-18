import "../config/bootstrap.js";
import { getProfileIdentity } from "../config/profileSelection.js";
import { reportCliError } from "../utils/cliError.js";
import { formatContentPlan } from "./formatter.js";
import { buildContentPlan } from "./pipeline.js";

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "plan" && command !== "diff") {
    console.log("Content synchronization has not been implemented yet.");
    return;
  }

  const profile = await getProfileIdentity();
  const plan = await buildContentPlan(profile.directory, profile.key);
  process.stdout.write(formatContentPlan(plan, profile.name, command));
}

main().catch((error: unknown) => {
  reportCliError(error);
  process.exitCode = 1;
});
