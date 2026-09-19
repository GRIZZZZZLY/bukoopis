import { resolveBackend, resolveModelId } from "@book-forge/llm";

/**
 * Настоящая подпись модели для варианта Мастерской (С7 ревью 2026-09-19).
 *
 * Варианты подписывались константой «subscription:claude-sonnet-4-6» во всех
 * восьми местах — независимо от бэкенда, от переопределения
 * `LLM_AGENT_BACKEND_MAP` и от выбранной модели. По такой подписи нельзя ни
 * понять, чем вариант написан, ни посчитать его стоимость.
 *
 * Живёт отдельным модулем, а не в маршруте: быстрый сбор тоже подписывает
 * варианты, и импорт из `routes/studio.ts` заводил цикл (маршрут импортирует
 * быстрый сбор).
 */
export function aspectModelLabel(
  agent: "aspect_variants" | "aspect_playbook" | "aspect_entity_variants",
  model: "sonnet" | "opus" = "sonnet",
): string {
  const id = resolveModelId(model);
  return resolveBackend(agent) === "subscription" ? `subscription:${id}` : id;
}
