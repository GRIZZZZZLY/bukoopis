import { registerCanonCriticContract } from "./critics/canon.js";
import { registerStyleCriticContract } from "./critics/style.js";
import { registerPhraseFixContract } from "./phrase-fix.js";
import { registerEditorCriticContract } from "./critics/editor.js";
import { registerReaderCriticContract } from "./critics/reader.js";
import { registerCanonGuardContract } from "./canon-extractor.js";
import { registerCanonFactExtractorContract } from "./canon-fact-extractor.js";
import { registerCharacterEventExtractorContract } from "./character-event-extractor.js";
import { registerSceneIntentContract } from "./scene-intent.js";
import { registerCastCheckContract } from "./cast-check.js";
import { registerSceneStateExtractorContract } from "./scene-state-extractor.js";
import { registerCharacterCriticContract } from "./critics/character.js";
import { registerEpisodicNoteExtractorContract } from "./episodic-note-extractor.js";
import { registerRerankerContract } from "./reranker.js";
import {
  registerPlotOutlineContract,
  registerPlotChapterPlanContract,
} from "./plot.js";
import { registerConceptRefinerContract } from "./concept/refiner.js";
import { registerPitchGeneratorContract } from "./concept/pitches.js";
import { registerPitchBlenderContract } from "./concept/pitch-blend.js";
import { registerAspectPlaybookContract } from "./aspects/playbook.js";
import { registerAspectVariantsContract } from "./aspects/variants.js";
import { registerAspectRefineContract } from "./aspects/refine.js";
import { registerAspectEntityVariantsContract } from "./aspects/entity-variants.js";
import { registerAspectDocumentContract } from "./aspects/document.js";
import { registerMaterialClassifierContract } from "./intake/classifier.js";

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
 * Замысел: pitch_generator, pitch_blender.
 * Приём материала: material_classifier.
 */
export function registerAllAgentContracts(): void {
  registerCanonCriticContract();
  registerStyleCriticContract();
  registerPhraseFixContract();
  registerEditorCriticContract();
  registerReaderCriticContract();
  registerCanonGuardContract();
  registerCanonFactExtractorContract();
  registerCharacterEventExtractorContract();
  registerSceneIntentContract();
  registerCastCheckContract();
  registerSceneStateExtractorContract();
  registerCharacterCriticContract();
  registerEpisodicNoteExtractorContract();
  registerRerankerContract();
  registerPlotOutlineContract();
  registerPlotChapterPlanContract();
  registerConceptRefinerContract();
  registerPitchGeneratorContract();
  registerPitchBlenderContract();
  registerAspectPlaybookContract();
  registerAspectVariantsContract();
  registerAspectRefineContract();
  registerAspectEntityVariantsContract();
  registerAspectDocumentContract();
  registerMaterialClassifierContract();
}
