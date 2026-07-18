import path from "node:path";
import { config as loadDotenv } from "dotenv";

export const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

export function loadProjectEnvironment(
  options: {
    projectRoot?: string;
    envFile?: string;
    environment?: NodeJS.ProcessEnv;
  } = {},
): NodeJS.ProcessEnv {
  const environment = options.environment ?? process.env;
  const envFile =
    options.envFile ?? path.join(options.projectRoot ?? PROJECT_ROOT, ".env");
  const result = loadDotenv({
    path: envFile,
    override: false,
    processEnv: environment,
    quiet: true,
  });
  const error = result.error as NodeJS.ErrnoException | undefined;
  if (error && error.code !== "ENOENT") {
    throw new Error(`Could not load project environment from ${envFile}.`, {
      cause: error,
    });
  }
  return environment;
}
