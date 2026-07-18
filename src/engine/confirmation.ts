import { SafetyError } from "./planSafety.js";

export function confirmationPhrase(action: "APPLY" | "RESTORE", guildName: string): string {
  return `${action} ${guildName}`;
}

export function requireConfirmation(
  actual: string,
  action: "APPLY" | "RESTORE",
  guildName: string,
): void {
  const expected = confirmationPhrase(action, guildName);
  if (actual !== expected) throw new SafetyError(`${action} confirmation rejected.`);
}
