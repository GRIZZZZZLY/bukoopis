import type { StudioState, StageAspect } from "./studio-state.js";

export interface StudioInvariantViolation {
  code:
    | "accepted_without_final_payload"
    | "selected_variant_missing"
    | "multiple_accepted_variants"
    | "parent_variant_missing"
    | "parent_variant_not_superseded"
    | "variant_payload_kind_mismatch"
    | "stage_complete_with_pending_required";
  stageId?: string;
  aspectId?: string;
  variantId?: string;
  message: string;
}

export function findInvariantViolations(state: StudioState): StudioInvariantViolation[] {
  const out: StudioInvariantViolation[] = [];
  for (const [stageId, stage] of Object.entries(state.stages)) {
    if (!stage) continue;
    if (stage.status === "complete") {
      const pendingRequired = stage.aspects.filter(
        (a) => a.required && a.status !== "accepted" && a.status !== "skipped",
      );
      if (pendingRequired.length > 0) {
        out.push({
          code: "stage_complete_with_pending_required",
          stageId,
          message: `stage "${stageId}" is complete but ${pendingRequired.length} required aspects are not accepted`,
        });
      }
    }
    for (const aspect of stage.aspects) {
      out.push(...inspectAspect(stageId, aspect));
    }
  }
  return out;
}

function inspectAspect(stageId: string, aspect: StageAspect): StudioInvariantViolation[] {
  const out: StudioInvariantViolation[] = [];
  if (aspect.status === "accepted" && aspect.finalPayload === undefined) {
    out.push({
      code: "accepted_without_final_payload",
      stageId,
      aspectId: aspect.id,
      message: `aspect "${aspect.id}" accepted but finalPayload is undefined`,
    });
  }
  if (aspect.selectedVariantId !== undefined) {
    const found = aspect.variants.find((v) => v.id === aspect.selectedVariantId);
    if (!found) {
      out.push({
        code: "selected_variant_missing",
        stageId,
        aspectId: aspect.id,
        message: `aspect "${aspect.id}" selectedVariantId "${aspect.selectedVariantId}" not in variants`,
      });
    }
  }
  const accepted = aspect.variants.filter((v) => v.status === "accepted");
  if (accepted.length > 1) {
    out.push({
      code: "multiple_accepted_variants",
      stageId,
      aspectId: aspect.id,
      message: `aspect "${aspect.id}" has ${accepted.length} accepted variants; max 1`,
    });
  }
  for (const v of aspect.variants) {
    if (v.payloadKind !== aspect.payloadKind) {
      out.push({
        code: "variant_payload_kind_mismatch",
        stageId,
        aspectId: aspect.id,
        variantId: v.id,
        message: `variant "${v.id}" payloadKind "${v.payloadKind}" does not match aspect.payloadKind "${aspect.payloadKind}"`,
      });
    }
    if (v.parentVariantId !== undefined) {
      const parent = aspect.variants.find((p) => p.id === v.parentVariantId);
      if (!parent) {
        out.push({
          code: "parent_variant_missing",
          stageId,
          aspectId: aspect.id,
          variantId: v.id,
          message: `variant "${v.id}" parentVariantId "${v.parentVariantId}" not found`,
        });
      } else if (parent.status !== "superseded") {
        out.push({
          code: "parent_variant_not_superseded",
          stageId,
          aspectId: aspect.id,
          variantId: v.id,
          message: `variant "${v.id}" parent "${parent.id}" must be in status "superseded" (got "${parent.status}")`,
        });
      }
    }
  }
  return out;
}

export function assertStudioStateInvariants(state: StudioState): void {
  const v = findInvariantViolations(state);
  if (v.length > 0) {
    const msg = v.map((x) => `[${x.code}] ${x.message}`).join("\n");
    throw new Error(`StudioState invariant violations:\n${msg}`);
  }
}
