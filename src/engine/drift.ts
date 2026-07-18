import type { PlanDocument } from "../planner/diffTypes.js";
import type { LiveSnapshot } from "../planner/types.js";
import { canonicalHash } from "../utils/canonicalJson.js";
import { SafetyError } from "./planSafety.js";

export function detectDrift(
  plan: PlanDocument,
  snapshot: LiveSnapshot,
): { drifted: boolean; expectedHash: string; actualHash: string } {
  if (!plan.snapshotGuild.id || snapshot.server.id !== plan.snapshotGuild.id) {
    throw new SafetyError("Guild identity mismatch during drift detection.");
  }
  const actualHash = canonicalHash(snapshot);
  return {
    drifted: actualHash !== plan.hashes.snapshot,
    expectedHash: plan.hashes.snapshot,
    actualHash,
  };
}
