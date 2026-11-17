import {
  chapterBeatSheetVariantSchema,
  type ChapterBeatSheetVariant,
} from "@book-forge/shared";
import type { ChapterRow } from "../db/rows.js";

/** Какой план действует у главы: выбранный вариант, свободное содержание или ничего. */
export type GenerationPlan =
  | { kind: "beats"; variant: ChapterBeatSheetVariant }
  | { kind: "intent"; intent: string }
  | { kind: "none" };

function selectedVariant(planJson: string | null): ChapterBeatSheetVariant | null {
  if (!planJson) return null;
  try {
    const plan = JSON.parse(planJson) as {
      variants?: unknown;
      selectedIndex?: unknown;
    } | null;
    const idx = plan?.selectedIndex;
    if (typeof idx !== "number" || !Array.isArray(plan?.variants)) return null;
    const parsed = chapterBeatSheetVariantSchema.safeParse(plan.variants[idx]);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function chapterPlanForGeneration(
  ch: Pick<ChapterRow, "active_plan_kind" | "plan_json" | "intent">,
): GenerationPlan {
  if (ch.active_plan_kind === "beats") {
    const variant = selectedVariant(ch.plan_json);
    if (variant) return { kind: "beats", variant };
  }
  const intent = ch.intent?.trim();
  return intent ? { kind: "intent", intent } : { kind: "none" };
}

/** FNV-1a: детерминированный 32-битный отпечаток строки, чтобы outline без
 *  собственной ревизии всё же попадал в ссылки на источники. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
