export function reportCliError(error: unknown): void {
  if (process.env.DISCORD_IAC_DEBUG === "1" && error instanceof Error) {
    console.error(error.stack ?? error.message);
    return;
  }
  console.error(error instanceof Error ? error.message : String(error));
}
