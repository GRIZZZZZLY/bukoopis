import { registerCanonCriticContract } from "./critics/canon.js";

/**
 * Registers all agent structured-output contracts. Must be called once at
 * server / runtime startup. Subsequent calls are idempotent (the registry
 * overwrites entries on re-register).
 *
 * Phase 1: only critic_canon is migrated. Subsequent phases append:
 *   Phase 3: critic_style, critic_editor, critic_reader.
 *   Phase 4: plot_outline, plot_chapter_plan, canon_guard, style_extractor.
 *   Phase 5: critic_dialogue, foreshadowing_planner.
 */
export function registerAllAgentContracts(): void {
  registerCanonCriticContract();
}
