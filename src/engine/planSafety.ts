import type { PlanDocument, StructuredOperation } from "../planner/diffTypes.js";

export class SafetyError extends Error {
  readonly exitCode = 2;
}

export function actionableOperations(document: PlanDocument): StructuredOperation[] {
  return document.operations.filter(
    (operation) =>
      operation.action !== "unchanged" && operation.action !== "warning",
  );
}

export function validatePlanSafety(
  document: PlanDocument,
  expected: {
    guildId?: string;
    snapshotHash?: string;
    profileHash?: string;
  } = {},
): void {
  if (!document.snapshotGuild?.id || !document.snapshotGuild.name) {
    throw new SafetyError("Plan is missing guild identity.");
  }
  if (expected.guildId && document.snapshotGuild.id !== expected.guildId) {
    throw new SafetyError("Guild ID does not match the saved plan.");
  }
  if (expected.snapshotHash && document.hashes.snapshot !== expected.snapshotHash) {
    throw new SafetyError("Snapshot hash does not match the saved plan.");
  }
  if (expected.profileHash && document.hashes.profile !== expected.profileHash) {
    throw new SafetyError("Profile hash does not match the saved plan.");
  }
  if (!document.executable) throw new SafetyError("Plan is marked non-executable.");
  if (document.ambiguityCount > 0) throw new SafetyError("Plan contains ambiguous matches.");
  if (document.unsupportedOperationCount > 0) {
    throw new SafetyError("Plan contains unsupported operations.");
  }
  if (document.missingRequiredIdCount > 0) {
    throw new SafetyError("Plan contains unresolved required Discord IDs.");
  }

  for (const operation of actionableOperations(document)) {
    if (!operation.supported) throw new SafetyError(`Unsupported operation: ${operation.label}`);
    if (operation.ambiguous) throw new SafetyError(`Ambiguous operation: ${operation.label}`);
    if ((operation.action as string) === "delete") {
      throw new SafetyError("Delete operations are forbidden in Discord IaC v1.0.");
    }
    if (
      operation.resourceType === "role" &&
      (operation.identity.name === "@everyone" ||
        operation.currentState?.managed === true)
    ) {
      throw new SafetyError(`Protected role operation rejected: ${operation.identity.name}`);
    }
  }
}

export function orderOperations(
  operations: StructuredOperation[],
): StructuredOperation[] {
  const byKey = new Map(
    operations.map((operation) => [operation.identity.profileKey ?? operation.sortKey, operation]),
  );
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: StructuredOperation[] = [];

  function visit(operation: StructuredOperation): void {
    const key = operation.identity.profileKey ?? operation.sortKey;
    if (visited.has(key)) return;
    if (visiting.has(key)) throw new SafetyError(`Operation dependency cycle at ${key}.`);
    visiting.add(key);
    for (const dependency of operation.dependencies) {
      const dependencyOperation = byKey.get(dependency);
      if (dependencyOperation) visit(dependencyOperation);
    }
    visiting.delete(key);
    visited.add(key);
    ordered.push(operation);
  }

  [...operations]
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
    .forEach(visit);
  return ordered;
}
