import { registerCanonCriticContract } from "./critics/canon.js";
import { registerStyleCriticContract } from "./critics/style.js";
import { registerEditorCriticContract } from "./critics/editor.js";
import { registerReaderCriticContract } from "./critics/reader.js";
import { registerCanonGuardContract } from "./canon-extractor.js";
import { registerCanonFactExtractorContract } from "./canon-fact-extractor.js";
import {
  registerPlotOutlineContract,
  registerPlotChapterPlanContract,
} from "./plot.js";
import { registerConceptRefinerContract } from "./concept/refiner.js";
import { registerAspectPlaybookContract } from "./aspects/playbook.js";
import { registerAspectVariantsContract } from "./aspects/variants.js";
import { registerAspectRefineContract } from "./aspects/refine.js";
import { registerAspectEntityVariantsContract } from "./aspects/entity-variants.js";

/**
 * Registers all agent structured-output contracts. Must be called once at
 * server / runtime startup. Subsequent calls are idempotent (the registry
 * overwrites entries on re-register).
 *
 * Phase 1: critic_canon.
 * Phase 3: critic_style, critic_editor, critic_reader.
 * Phase 4: plot_outline, plot_chapter_plan, canon_guard, style_extractor.
 * Phase 5: critic_dialogue, foreshadowing_planner.
 * Phase B2 (Studio): concept_refiner.
 * Phase C2 (Studio): aspect_playbook, aspect_variants, aspect_refine.
 */
export function registerAllAgentContracts(): void {
  registerCanonCriticContract();
  registerStyleCriticContract();
  registerEditorCriticContract();
  registerReaderCriticContract();
  registerCanonGuardContract();
  registerCanonFactExtractorContract();
  registerPlotOutlineContract();
  registerPlotChapterPlanContract();
  registerConceptRefinerContract();
  registerAspectPlaybookContract();
  registerAspectVariantsContract();
  registerAspectRefineContract();
  registerAspectEntityVariantsContract();
}
