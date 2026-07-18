import "../config/bootstrap.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadProfile } from "../config/profileLoader.js";
import { validateProfile } from "../config/profileValidator.js";
import { createPlanDocument } from "./diffEngine.js";
import { prettyCanonicalJson } from "../utils/canonicalJson.js";
import { reportCliError } from "../utils/cliError.js";
import { getProfileDirectory } from "../config/profileSelection.js";
import { formatDetailedDiff } from "./diffFormatter.js";
import { buildPlan } from "./resolver.js";
import { loadSnapshot } from "./snapshotLoader.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const jsonIndex = args.indexOf("--json");
  const jsonPath = jsonIndex >= 0 ? args[jsonIndex + 1] : undefined;
  const positional = args.filter(
    (_value, index) =>
      jsonIndex < 0 || (index !== jsonIndex && index !== jsonIndex + 1),
  );
  const profileDirectory = positional[0] ?? getProfileDirectory();
  const exportsDirectory = positional[1] ?? "exports";
  const profile = await loadProfile(profileDirectory);
  const errors = validateProfile(profile);
  if (errors.length > 0) {
    throw new Error(`Profile is invalid:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
  const snapshot = await loadSnapshot(exportsDirectory);
  const plan = buildPlan(profile, snapshot);
  const document = createPlanDocument(profile, snapshot, plan);

  if (jsonIndex >= 0) {
    const outputPath = path.resolve(
      jsonPath ?? `plans/${profile.metadata.key}.plan.json`,
    );
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, prettyCanonicalJson(document), "utf8");
    console.log(`Deterministic plan JSON written to: ${outputPath}`);
    console.log("No Discord changes were made.");
    return;
  }

  console.log(`Detailed offline diff for: ${profile.metadata.name}`);
  formatDetailedDiff(document.operations);
}

main().catch((error: unknown) => {
  reportCliError(error);
  console.error("No Discord changes were made.");
  process.exitCode = 1;
});
