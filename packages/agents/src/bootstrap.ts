import { registerCanonCriticContract } from "./critics/canon.js";
import { registerStyleCriticContract } from "./critics/style.js";
import { registerEditorCriticContract } from "./critics/editor.js";
import { registerReaderCriticContract } from "./critics/reader.js";
import { registerCanonGuardContract } from "./canon-extractor.js";
import {
  registerPlotOutlineContract,
  registerPlotChapterPlanContract,
} from "./plot.js";
import { registerConceptRefinerContract } from "./concept/refiner.js";

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
 */
export function registerAllAgentContracts(): void {
  registerCanonCriticContract();
  registerStyleCriticContract();
  registerEditorCriticContract();
  registerReaderCriticContract();
  registerCanonGuardContract();
  registerPlotOutlineContract();
  registerPlotChapterPlanContract();
  registerConceptRefinerContract();
}
