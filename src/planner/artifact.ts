import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PlanDocument } from "./diffTypes.js";

export async function loadPlanDocument(filePath: string): Promise<PlanDocument> {
  const absolutePath = path.resolve(filePath);
  try {
    const document = JSON.parse(await readFile(absolutePath, "utf8")) as PlanDocument;
    if (document.schemaVersion !== 1 || !Array.isArray(document.operations)) {
      throw new Error("Unsupported or malformed plan schema.");
    }
    return document;
  } catch (error) {
    throw new Error(`Could not load plan artifact ${absolutePath}.`, { cause: error });
  }
}
