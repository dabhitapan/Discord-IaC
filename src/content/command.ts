import "../config/bootstrap.js";
import { getProfileIdentity } from "../config/profileSelection.js";
import { reportCliError } from "../utils/cliError.js";
import { formatContentPlan } from "./formatter.js";
import { buildContentPlan, loadValidatedContentProfile } from "./pipeline.js";
import {
  createContentPlanArtifact,
  writeContentPlanArtifact,
} from "./planArtifact.js";

function outputPathArgument(): string | undefined {
  const index = process.argv.indexOf("--out");
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error("--out requires a file path.");
  return value;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "plan" && command !== "diff" && command !== "validate") {
    console.log("Content synchronization has not been implemented yet.");
    return;
  }

  const profile = await getProfileIdentity();
  if (command === "validate") {
    const { loaded, targetWarnings } = await loadValidatedContentProfile(profile.directory);
    console.log(`Content manifest valid for: ${profile.name}`);
    console.log(`documents: ${loaded.manifest.documents.length}`);
    console.log(`enabled: ${loaded.documents.length}`);
    console.log(`warnings: ${loaded.warnings.length + targetWarnings.length}`);
    for (const warning of [...loaded.warnings, ...targetWarnings]) {
      console.log(`- ${warning.documentId ? `${warning.documentId}: ` : ""}${warning.message}`);
    }
    console.log("\nNo Discord changes were made.");
    return;
  }

  const plan = await buildContentPlan(profile.directory, profile.key, profile.name);
  process.stdout.write(formatContentPlan(plan, profile.name, command));
  const outputPath = outputPathArgument();
  if (outputPath) {
    if (command !== "plan") throw new Error("--out is supported only by content:plan.");
    const writtenPath = await writeContentPlanArtifact(
      outputPath,
      createContentPlanArtifact(plan),
    );
    console.log(`Plan artifact: ${writtenPath}`);
  }
}

main().catch((error: unknown) => {
  reportCliError(error);
  process.exitCode = 1;
});
