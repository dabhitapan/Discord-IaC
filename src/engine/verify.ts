import "../config/bootstrap.js";
import { loadProfile } from "../config/profileLoader.js";
import { validateProfile } from "../config/profileValidator.js";
import { createPlanDocument } from "../planner/diffEngine.js";
import { buildPlan } from "../planner/resolver.js";
import { loadSnapshot } from "../planner/snapshotLoader.js";
import { actionableOperations } from "./planSafety.js";
import { reportCliError } from "../utils/cliError.js";
import { getProfileDirectory } from "../config/profileSelection.js";

async function main(): Promise<void> {
  const profilePath = process.argv[2] ?? getProfileDirectory();
  const snapshotPath = process.argv[3] ?? "exports";
  const profile = await loadProfile(profilePath);
  const errors = validateProfile(profile);
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 2;
    return;
  }
  const snapshot = await loadSnapshot(snapshotPath);
  const document = createPlanDocument(
    profile,
    snapshot,
    buildPlan(profile, snapshot),
  );
  if (document.ambiguityCount > 0 || document.missingRequiredIdCount > 0) {
    console.error("Verification aborted because matching or identity is unsafe.");
    process.exitCode = 2;
    return;
  }
  const actionable = actionableOperations(document);
  console.log(`Offline verification: ${actionable.length} actionable operation(s).`);
  console.log("No Discord changes were made.");
  process.exitCode = actionable.length > 0 ? 1 : 0;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    reportCliError(error);
    process.exitCode = 2;
  });
}
