import "../config/bootstrap.js";
import {
  getProfileIdentity,
  printProfileContext,
} from "../config/profileSelection.js";
import { reportCliError } from "../utils/cliError.js";
import { buildContentPlan } from "./pipeline.js";
import { DiscordJsReadOnlyContentGateway } from "./readOnlyDiscordGateway.js";
import {
  contentVerificationFailed,
  verifyContentDestinations,
} from "./verificationEngine.js";
import {
  ContentVerificationConfigurationError,
  getContentVerificationEnvironment,
} from "./verificationConfig.js";
import { formatContentVerification } from "./verificationFormatter.js";
import {
  createContentVerificationArtifact,
  writeContentVerificationArtifact,
} from "./verificationArtifact.js";

function outputPathArgument(): string | undefined {
  const index = process.argv.indexOf("--out");
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error("--out requires a file path.");
  return value;
}

async function main(): Promise<void> {
  const profile = await getProfileIdentity();
  const environment = getContentVerificationEnvironment();
  const plan = await buildContentPlan(profile.directory, profile.key, profile.name);
  printProfileContext(profile);
  console.log("ONLINE READ-ONLY CONTENT VERIFICATION");

  const gateway = new DiscordJsReadOnlyContentGateway();
  try {
    await gateway.connect(environment.token);
    const report = await verifyContentDestinations({
      gateway,
      configuredGuildId: environment.guildId,
      plan,
    });
    process.stdout.write(formatContentVerification(report));
    const outputPath = outputPathArgument();
    if (outputPath) {
      const writtenPath = await writeContentVerificationArtifact(
        outputPath,
        createContentVerificationArtifact(report),
      );
      console.log(`Verification report: ${writtenPath}`);
    }
    process.exitCode = contentVerificationFailed(report) ? 1 : 0;
  } finally {
    gateway.disconnect();
  }
}

main().catch((error: unknown) => {
  reportCliError(error);
  process.exitCode = error instanceof ContentVerificationConfigurationError ? 2 : 1;
});
