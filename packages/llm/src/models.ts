import { MODEL_IDS, type ModelChoice } from "@book-forge/shared";

export { MODEL_IDS };

export function resolveModelId(choice: ModelChoice): string {
  return MODEL_IDS[choice];
}
