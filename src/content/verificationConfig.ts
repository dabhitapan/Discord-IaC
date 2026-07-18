export class ContentVerificationConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentVerificationConfigurationError";
  }
}

export function getContentVerificationEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): { token: string; guildId: string } {
  const token = environment.DISCORD_TOKEN?.trim();
  const guildId = environment.GUILD_ID?.trim();
  const missing = [
    ...(!token ? ["DISCORD_TOKEN"] : []),
    ...(!guildId ? ["GUILD_ID"] : []),
  ];
  if (!token || !guildId) {
    throw new ContentVerificationConfigurationError(
      `Content verification requires ${missing.join(" and ")}. Configure the missing environment ${
        missing.length === 1 ? "variable" : "variables"
      } before running npm run content:verify.`,
    );
  }
  return { token, guildId };
}
