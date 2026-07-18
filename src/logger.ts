import type { ExportSummary } from "./types.js";

export function logExportSummary(summary: ExportSummary): void {
  console.log(`Roles exported: ${summary.roles}`);
  console.log(`Categories exported: ${summary.categories}`);
  console.log(`Channels exported: ${summary.channels}`);
  console.log(`Permission overwrites exported: ${summary.permissionOverwrites}`);
  console.log(`Output directory: ${summary.outputDirectory}`);
  console.log("Export complete. No Discord server changes were made.");
}

export function logError(error: unknown): void {
  if (process.env.DISCORD_IAC_DEBUG === "1" && error instanceof Error) {
    console.error(error.stack ?? error.message);
    console.error("No Discord server changes were made.");
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Export failed: ${message}`);
  console.error("No Discord server changes were made.");
}
