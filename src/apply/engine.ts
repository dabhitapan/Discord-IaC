import type { DesiredProfile, LiveSnapshot } from "../planner/types.js";
import type { PlanDocument, StructuredOperation } from "../planner/diffTypes.js";
import { buildPlan } from "../planner/resolver.js";
import {
  createPlanDocument,
  hashPlanDocument,
} from "../planner/diffEngine.js";
import {
  actionableOperations,
  orderOperations,
  SafetyError,
  validatePlanSafety,
} from "../engine/planSafety.js";
import { canonicalHash, canonicalJson } from "../utils/canonicalJson.js";
import { confirmationPhrase, requireConfirmation } from "../engine/confirmation.js";

export interface ApplyAdapters {
  getFreshSnapshot(): Promise<LiveSnapshot>;
  requestConfirmation(expectedPhrase: string): Promise<string>;
  createBackup(snapshot: LiveSnapshot, planHash: string): Promise<string>;
  execute(operation: StructuredOperation): Promise<void>;
  getPostApplySnapshot(): Promise<LiveSnapshot>;
}

export interface ApplyResult {
  status: "noop" | "applied";
  executed: number;
  backupDirectory?: string;
}

export async function executeGuardedPlan(
  profile: DesiredProfile,
  savedPlan: PlanDocument,
  adapters: ApplyAdapters,
): Promise<ApplyResult> {
  validatePlanSafety(savedPlan, { profileHash: canonicalHash(profile) });
  const savedActions = actionableOperations(savedPlan);
  if (savedActions.length === 0) return { status: "noop", executed: 0 };

  const freshSnapshot = await adapters.getFreshSnapshot();
  if (freshSnapshot.server.id !== savedPlan.snapshotGuild.id) {
    throw new SafetyError("Live guild ID does not match the saved plan.");
  }
  if (canonicalHash(freshSnapshot) !== savedPlan.hashes.snapshot) {
    const freshDocument = createPlanDocument(
      profile,
      freshSnapshot,
      buildPlan(profile, freshSnapshot),
    );
    if (actionableOperations(freshDocument).length === 0) {
      return { status: "noop", executed: 0 };
    }
    throw new SafetyError("Live server drift detected; write a new plan before applying.");
  }

  const recomputed = createPlanDocument(
    profile,
    freshSnapshot,
    buildPlan(profile, freshSnapshot),
  );
  validatePlanSafety(recomputed);
  if (canonicalJson(recomputed.operations) !== canonicalJson(savedPlan.operations)) {
    throw new SafetyError("Recomputed operations differ from the saved plan.");
  }

  const expectedPhrase = confirmationPhrase("APPLY", savedPlan.snapshotGuild.name);
  const confirmation = await adapters.requestConfirmation(expectedPhrase);
  requireConfirmation(confirmation, "APPLY", savedPlan.snapshotGuild.name);

  const planHash = hashPlanDocument(savedPlan);
  const backupDirectory = await adapters.createBackup(freshSnapshot, planHash);
  let executed = 0;
  try {
    for (const operation of orderOperations(savedActions)) {
      await adapters.execute(operation);
      executed += 1;
    }
  } catch (error) {
    throw new Error(
      `Apply stopped after ${executed} of ${savedActions.length} operations. Backup: ${backupDirectory}`,
      { cause: error },
    );
  }

  const postApplySnapshot = await adapters.getPostApplySnapshot();
  const remaining = actionableOperations(
    createPlanDocument(
      profile,
      postApplySnapshot,
      buildPlan(profile, postApplySnapshot),
    ),
  );
  if (remaining.length > 0) {
    throw new Error(`Post-apply verification found ${remaining.length} actionable operations.`);
  }
  return { status: "applied", executed, backupDirectory };
}

export async function withClientCleanup<T>(
  client: { destroy(): void },
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } finally {
    client.destroy();
  }
}
