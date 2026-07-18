import type {
  FieldChange,
  PermissionChanges,
  PermissionOverwriteState,
  StructuredOperation,
} from "./diffTypes.js";

function formatValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  return JSON.stringify(value, null, 2)?.replace(/\n/g, "\n      ") ?? "undefined";
}

function printFieldChange(change: FieldChange): void {
  if (change.added && change.removed) {
    console.log(`  ${change.field}:`);
    for (const value of change.added) console.log(`    + ${formatValue(value)}`);
    for (const value of change.removed) console.log(`    - ${formatValue(value)}`);
    return;
  }
  console.log(`  ${change.field}:`);
  console.log(`    before: ${formatValue(change.before)}`);
  console.log(`    after:  ${formatValue(change.after)}`);
}

function changedLines(added: string[], removed: string[]): string[] {
  return [
    ...added.map((permission) => `+ ${permission}`),
    ...removed.map((permission) => `- ${permission}`),
  ];
}

function printPermissionChanges(changes: PermissionChanges, roleMode = false): void {
  if (roleMode) {
    const lines = changedLines(changes.allowAdded, changes.allowRemoved);
    if (lines.length === 0) return;
    console.log("  permissions:");
    lines.forEach((line) => console.log(`    ${line}`));
    return;
  }

  console.log("  allow:");
  const allowLines = changedLines(changes.allowAdded, changes.allowRemoved);
  if (allowLines.length === 0) console.log("    none");
  else allowLines.forEach((line) => console.log(`    ${line}`));

  console.log("  deny:");
  const denyLines = changedLines(changes.denyAdded, changes.denyRemoved);
  if (denyLines.length === 0) console.log("    none");
  else denyLines.forEach((line) => console.log(`    ${line}`));
}

function formatOverwrite(overwrite: PermissionOverwriteState): string {
  const allow = overwrite.allow.length > 0 ? overwrite.allow.join(", ") : "none";
  const deny = overwrite.deny.length > 0 ? overwrite.deny.join(", ") : "none";
  return `${overwrite.target.name}: allow=[${allow}] deny=[${deny}]`;
}

function printSynchronization(operation: StructuredOperation): void {
  const sync = operation.synchronization;
  if (!sync) return;
  console.log(`  parent: ${sync.desiredParent.name}`);
  console.log(`  current mode: ${sync.currentMode}`);
  console.log(`  desired mode: ${sync.desiredMode}`);
  console.log(`  permissionsLocked: ${String(sync.permissionsLocked)}`);
  console.log("  current channel overwrites:");
  if (sync.currentOverwrites.length === 0) console.log("    none");
  else sync.currentOverwrites.forEach((item) => console.log(`    ${formatOverwrite(item)}`));
  console.log("  desired parent overwrites:");
  if (sync.desiredParentOverwrites.length === 0) console.log("    none");
  else
    sync.desiredParentOverwrites.forEach((item) =>
      console.log(`    ${formatOverwrite(item)}`),
    );
  console.log("  overwrite differences:");
  if (sync.overwriteDifferences.length === 0) {
    console.log("    none");
  } else {
    for (const difference of sync.overwriteDifferences) {
      console.log(`    ${difference.target.name}:`);
      const allowLines = changedLines(
        difference.changes.allowAdded,
        difference.changes.allowRemoved,
      );
      const denyLines = changedLines(
        difference.changes.denyAdded,
        difference.changes.denyRemoved,
      );
      if (allowLines.length > 0) {
        console.log("      allow:");
        allowLines.forEach((line) => console.log(`        ${line}`));
      }
      if (denyLines.length > 0) {
        console.log("      deny:");
        denyLines.forEach((line) => console.log(`        ${line}`));
      }
    }
  }
  console.log("  action:");
  console.log(`    ${sync.action}`);
}

function printOperation(operation: StructuredOperation): void {
  const displayAction = operation.ambiguous
    ? "BLOCKED"
    : operation.action.toUpperCase();
  console.log(`\n[${displayAction}] ${operation.label}`);

  if (operation.permissionOverwrite) {
    console.log(`  target: ${operation.permissionOverwrite.target.name}`);
    console.log(`  overwrite type: ${operation.permissionOverwrite.targetType}`);
  }

  for (const change of operation.fieldChanges.filter(
    (item) => !(operation.resourceType === "role" && item.field === "permissions"),
  )) {
    printFieldChange(change);
  }
  if (operation.permissionChanges) {
    printPermissionChanges(
      operation.permissionChanges,
      operation.resourceType === "role",
    );
  }
  printSynchronization(operation);
  if (
    operation.fieldChanges.length === 0 &&
    !operation.permissionChanges &&
    !operation.synchronization
  ) {
    console.log(`  ${operation.detail}`);
  }
}

export function formatDetailedDiff(operations: StructuredOperation[]): void {
  const visible = operations.filter(
    (operation) => operation.action !== "unchanged" && operation.action !== "warning",
  );
  const sections: Array<[string, StructuredOperation["resourceType"][]]> = [
    ["Roles", ["role"]],
    ["Categories", ["category"]],
    ["Channels", ["channel"]],
    ["Permission overwrites", ["permission-overwrite"]],
    ["Permission synchronization", ["permission-sync"]],
  ];
  for (const [title, types] of sections) {
    const sectionOperations = visible.filter((operation) =>
      types.includes(operation.resourceType),
    );
    if (sectionOperations.length === 0) continue;
    console.log(`\n${title}`);
    console.log("-".repeat(title.length));
    sectionOperations.forEach(printOperation);
  }
  console.log("\nNo Discord changes were made.");
}
