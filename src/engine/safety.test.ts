import assert from "node:assert/strict";
import test from "node:test";
import { executeGuardedPlan, withClientCleanup } from "../apply/engine.js";
import { confirmationPhrase, requireConfirmation } from "./confirmation.js";
import { createOperation, createPlanDocument } from "../planner/diffEngine.js";
import { buildPlan } from "../planner/resolver.js";
import type { DesiredProfile, LiveSnapshot } from "../planner/types.js";
import type { PlanDocument, StructuredOperation } from "../planner/diffTypes.js";
import { canonicalHash } from "../utils/canonicalJson.js";
import { orderOperations, validatePlanSafety } from "./planSafety.js";
import { detectDrift } from "./drift.js";
import { buildRestoreOperations } from "../restore/planner.js";

function profile(permissions = ["ViewChannel"]): DesiredProfile {
  return {
    metadata: { key: "test", name: "Test Guild", version: 1 },
    roles: [
      {
        key: "staff",
        name: "Staff",
        permissions,
        deniedPermissions: [],
      },
    ],
    categories: [],
    channels: [],
    permissionRules: [],
  };
}

function snapshot(permissions: string[] = []): LiveSnapshot {
  return {
    server: { id: "guild", name: "Test Guild" },
    roles: [
      {
        id: "staff-id",
        name: "Staff",
        position: 1,
        managed: false,
        permissions,
        color: 0,
        hoist: false,
        mentionable: false,
      },
    ],
    categories: [],
    channels: [],
    permissionOverwrites: [],
  };
}

function document(desired = profile(), current = snapshot()): PlanDocument {
  return createPlanDocument(desired, current, buildPlan(desired, current));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

test("plan safety rejects guild mismatch and missing guild identity", () => {
  const plan = document();
  assert.throws(() => validatePlanSafety(plan, { guildId: "other" }), /Guild ID/);
  const missing = clone(plan);
  missing.snapshotGuild.id = "";
  assert.throws(() => validatePlanSafety(missing), /missing guild identity/i);
});

test("plan safety rejects profile and snapshot hash mismatch", () => {
  const plan = document();
  assert.throws(
    () => validatePlanSafety(plan, { profileHash: "wrong" }),
    /Profile hash/,
  );
  assert.throws(
    () => validatePlanSafety(plan, { snapshotHash: "wrong" }),
    /Snapshot hash/,
  );
});

test("plan safety rejects unsupported, ambiguous, managed, and delete operations", () => {
  const unsupported = clone(document());
  unsupported.operations[0].supported = false;
  unsupported.unsupportedOperationCount = 1;
  unsupported.executable = false;
  assert.throws(() => validatePlanSafety(unsupported), /non-executable|unsupported/i);

  const ambiguous = clone(document());
  ambiguous.operations[0].ambiguous = true;
  ambiguous.ambiguityCount = 1;
  ambiguous.executable = false;
  assert.throws(() => validatePlanSafety(ambiguous), /non-executable|ambiguous/i);

  const managed = clone(document());
  managed.operations[0].currentState = { managed: true };
  assert.throws(() => validatePlanSafety(managed), /Protected role/);

  const deletion = clone(document());
  (deletion.operations[0] as { action: string }).action = "delete";
  assert.throws(() => validatePlanSafety(deletion), /Delete operations/);
});

test("drift detection rejects guild mismatch and detects changed content", () => {
  const plan = document();
  assert.throws(
    () => detectDrift(plan, { ...snapshot(), server: { id: "other", name: "Other" } }),
    /Guild identity/,
  );
  assert.equal(detectDrift(plan, snapshot()).drifted, false);
  assert.equal(detectDrift(plan, snapshot(["OtherPermission"])).drifted, true);
});

function adapters(options: {
  current?: LiveSnapshot;
  post?: LiveSnapshot;
  confirmation?: string;
  backupError?: Error;
  execute?: (operation: StructuredOperation) => Promise<void>;
} = {}) {
  return {
    getFreshSnapshot: async () => options.current ?? snapshot(),
    requestConfirmation: async () => options.confirmation ?? "APPLY Test Guild",
    createBackup: async () => {
      if (options.backupError) throw options.backupError;
      return "backup-dir";
    },
    execute: options.execute ?? (async () => undefined),
    getPostApplySnapshot: async () => options.post ?? snapshot(["ViewChannel"]),
  };
}

test("apply rejects confirmation, drift, and backup failure before writes", async () => {
  const desired = profile();
  const plan = document(desired, snapshot());
  let writes = 0;
  await assert.rejects(
    executeGuardedPlan(desired, plan, adapters({ confirmation: "yes", execute: async () => { writes += 1; } })),
    /confirmation/i,
  );
  await assert.rejects(
    executeGuardedPlan(
      desired,
      plan,
      adapters({ current: snapshot(["Drifted"]), execute: async () => { writes += 1; } }),
    ),
    /drift/i,
  );
  await assert.rejects(
    executeGuardedPlan(
      desired,
      plan,
      adapters({ backupError: new Error("disk full"), execute: async () => { writes += 1; } }),
    ),
    /disk full/,
  );
  assert.equal(writes, 0);
});

test("apply passes only structured operations and reports partial failure", async () => {
  const desired = profile();
  const plan = document(desired, snapshot());
  const received: StructuredOperation[] = [];
  const result = await executeGuardedPlan(
    desired,
    plan,
    adapters({ execute: async (operation) => { received.push(operation); } }),
  );
  assert.equal(result.status, "applied");
  assert.equal(received.length, 1);
  assert.equal(received[0].resourceType, "role");
  assert.ok(received[0].sortKey);

  await assert.rejects(
    executeGuardedPlan(
      desired,
      plan,
      adapters({ execute: async () => { throw new Error("writer failed"); } }),
    ),
    /stopped after 0 of 1/,
  );
});

test("no-op apply performs no snapshot, backup, confirmation, or write", async () => {
  const desired = profile();
  const converged = snapshot(["ViewChannel"]);
  const plan = document(desired, converged);
  let calls = 0;
  const result = await executeGuardedPlan(desired, plan, {
    getFreshSnapshot: async () => { calls += 1; return converged; },
    requestConfirmation: async () => { calls += 1; return ""; },
    createBackup: async () => { calls += 1; return ""; },
    execute: async () => { calls += 1; },
    getPostApplySnapshot: async () => { calls += 1; return converged; },
  });
  assert.deepEqual(result, { status: "noop", executed: 0 });
  assert.equal(calls, 0);
});

test("rerunning a previously applied saved plan converges to a no-op", async () => {
  const desired = profile();
  const saved = document(desired, snapshot());
  let writes = 0;
  const result = await executeGuardedPlan(
    desired,
    saved,
    adapters({
      current: snapshot(["ViewChannel"]),
      execute: async () => {
        writes += 1;
      },
    }),
  );
  assert.deepEqual(result, { status: "noop", executed: 0 });
  assert.equal(writes, 0);
});

test("operation dependencies are ordered and unsupported creates prevent duplicates", () => {
  const dependency = createOperation(
    "permission-overwrite",
    "create",
    { profileKey: "first", discordId: "scope:target", name: "first" },
    "first",
    "first",
  );
  const dependent = createOperation(
    "permission-sync",
    "sync-permissions",
    {
      profileKey: "second",
      discordId: "channel",
      name: "second",
      parent: { discordId: "category", name: "category" },
    },
    "second",
    "second",
    { dependencies: ["first"] },
  );
  assert.deepEqual(orderOperations([dependent, dependency]).map((item) => item.label), [
    "first",
    "second",
  ]);
  const resourceCreate = createOperation(
    "channel",
    "create",
    { profileKey: "new", name: "new" },
    "new",
    "new",
  );
  assert.equal(resourceCreate.supported, false);
});

test("client cleanup runs on success and failure", async () => {
  let destroys = 0;
  assert.equal(
    await withClientCleanup({ destroy: () => { destroys += 1; } }, async () => 42),
    42,
  );
  await assert.rejects(
    withClientCleanup({ destroy: () => { destroys += 1; } }, async () => {
      throw new Error("failure");
    }),
    /failure/,
  );
  assert.equal(destroys, 2);
});

test("confirmation phrases reject casual input for apply and restore", () => {
  assert.equal(confirmationPhrase("RESTORE", "Test Guild"), "RESTORE Test Guild");
  assert.throws(() => requireConfirmation("y", "APPLY", "Test Guild"), /rejected/);
  assert.throws(() => requireConfirmation("RESTORE other", "RESTORE", "Test Guild"), /rejected/);
});

test("restore aborts guild mismatch and never deletes or recreates missing resources", () => {
  assert.throws(
    () =>
      buildRestoreOperations(snapshot(), {
        ...snapshot(),
        server: { id: "other", name: "Other" },
      }),
    /guild mismatch/i,
  );
  const missing = buildRestoreOperations(snapshot(), {
    ...snapshot(),
    roles: [],
  });
  assert.ok(missing.some((operation) => operation.action === "warning"));
  assert.ok(missing.every((operation) => (operation.action as string) !== "delete"));
  assert.ok(missing.every((operation) => operation.resourceType !== "role" || operation.action !== "create"));
});

test("restore protects managed roles and dry-run planning is pure", () => {
  const backup = snapshot();
  const current = snapshot();
  current.roles[0].managed = true;
  const beforeHash = canonicalHash(current);
  const operations = buildRestoreOperations(backup, current);
  assert.ok(operations.some((operation) => operation.action === "warning"));
  assert.equal(canonicalHash(current), beforeHash);
});
