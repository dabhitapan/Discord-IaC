import type { OperationAction } from "./diffTypes.js";
import { flattenPlan } from "./diffEngine.js";
import type { PlanAction, PlanResult } from "./types.js";

const order: OperationAction[] = [
  "create",
  "update",
  "reorder",
  "sync-permissions",
  "unchanged",
  "warning",
];

function printSection(title: string, actions: PlanAction[]): void {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
  if (actions.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const item of actions) {
    console.log(`  [${item.action.toUpperCase()}] ${item.label} — ${item.detail}`);
  }
}

function printPermissionGroup(title: string, actions: PlanAction[]): void {
  console.log(`${title}:`);
  if (actions.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const item of actions) {
    console.log(`  [${item.action.toUpperCase()}] ${item.label} — ${item.detail}`);
  }
}

export function formatPlan(plan: PlanResult): void {
  printSection("Roles", plan.roles);
  printSection("Categories", plan.categories);
  printSection("Channels", plan.channels);
  console.log("\nPermissions");
  console.log("-----------");
  printPermissionGroup("Category overwrites", plan.permissions.categoryOverwrites);
  console.log();
  printPermissionGroup("Channel overwrites", plan.permissions.channelOverwrites);
  console.log();
  printPermissionGroup(
    "Permission synchronization",
    plan.permissions.synchronization,
  );
  printSection("Unmanaged resources", plan.unmanaged);

  const allActions = flattenPlan(plan);
  console.log("\nSummary");
  console.log("-------");
  for (const kind of order) {
    console.log(`  ${kind}: ${allActions.filter((item) => item.action === kind).length}`);
  }
  console.log("No Discord changes were made.");
}
