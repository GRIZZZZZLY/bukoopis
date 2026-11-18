import { renderClicheRule } from "@book-forge/shared";
import type { AgentName } from "@book-forge/llm";

/** Общие правила языка для всех помощников, чей текст автор читает как текст. */
export const AUTHOR_FACING_LANGUAGE_RULES = `${renderClicheRule()}
— Язык: простой русский.
  Без противопоставлений «не X, а Y» и «не только X, но и Y»: сразу скажи, что есть.
  Без калек с английского: «эмоциональный хребет», «янг-эдалт», «клиффхэнгер». Слово «крючок» как название поля допустимо.`;

/** Правила языка агентов замысла (питчи, смешивание, уточнение полей): общее ядро,
 *  регистр записки и «арка». В планах, карточках и заметках «арка» — рабочее
 *  слово; жаргоном она была только в питчах. */
export const CONCEPT_LANGUAGE_RULES = `${AUTHOR_FACING_LANGUAGE_RULES}
— Пиши как рабочая записка редактора к автору.
  Без похвалы книге и оценочных прилагательных о ней.
  Без кальки «арка (персонажа)».`;

/** Агенты без правила языка: имя → почему. Страж языка требует причину у каждого. */
export const LANGUAGE_RULE_EXEMPT: Partial<Record<AgentName, string>> = {
  // Без вызова модели: только собирают контекст из базы.
  lore: "No model call: it assembles lore context from the database for other prompts.",
  character: "No model call: it assembles character cards from the database for other prompts.",
  // Настроенная цепочка прозы: Writer → критики → Reviser, inline.
  writer: "Tuned prose chain; its prompt already has its own cliché rule and is out of this plan.",
  editor: "Tuned prose chain (the Reviser); its prompt already has its own cliché rule and is out of this plan.",
  inline: "Tuned prose chain; its prompt already has its own cliché rule and is out of this plan.",
  editor_phrase: "Tuned prose chain: it returns before/after phrase fixes applied in code.",
  critic_canon: "Tuned critic chain; its prompt is out of this plan.",
  critic_style: "Tuned critic chain; its prompt is out of this plan.",
  critic_style_phrase: "Tuned critic chain: it quotes phrases and names reasons, never rewrites.",
  critic_editor: "Tuned critic chain; its prompt is out of this plan.",
  critic_reader: "Tuned critic chain; its prompt is out of this plan.",
  critic_character: "Tuned critic chain; its prompt is out of this plan.",
  canon_guard: "Tuned chain: it extracts canon candidates from chapter text for review.",
  // Возвращают факты, метки, цитаты или рабочие заметки для другого промпта.
  canon_fact_extractor: "Extractor: returns canon facts with quotes for memory.",
  character_event_extractor: "Extractor: returns character events with verbatim quotes for memory.",
  episodic_note_extractor: "Its notes are memory, shown read-only in Memory notes; they must stay accurate, so no style rule.",
  scene_state_extractor: "Extractor: returns scene state facts for memory.",
  reranker: "Returns relevance scores for retrieval, no text.",
  material_classifier: "Fragment bodies are the author's own text verbatim; only short captions and titles are model text.",
  summarizer: "Summaries feed other prompts and memory, where accuracy outranks style; the cliché list bans meaning-bearing words such as «казалось».",
  scene_intent: "Returns working notes on each participant's intent for the Writer prompt.",
  // Регистрируются в сервере (style-engine).
  style_extractor: "Registered in the server: it describes the author's style as a fingerprint.",
  style_blender: "Registered in the server: it blends style fingerprints, no author-facing prose.",
};

/**
 * Каждое имя либо несёт AUTHOR_FACING_LANGUAGE_RULES во всех своих системных
 * промптах, либо стоит в списке исключений с причиной, но не то и другое разом.
 * Возвращает список нарушений; пустой список значит, что всё покрыто.
 */
export function checkLanguageRuleCoverage(
  names: readonly string[],
  getSystemPrompts: (name: string) => readonly string[],
  exempt: Partial<Record<string, string>>,
): string[] {
  const problems: string[] = [];
  for (const name of names) {
    const prompts = getSystemPrompts(name);
    const carries =
      prompts.length > 0 && prompts.every((p) => p.includes(AUTHOR_FACING_LANGUAGE_RULES));
    const reason = exempt[name];
    if (carries && reason !== undefined) {
      problems.push(`${name}: carries the language rule and is also listed as exempt`);
    } else if (!carries && !reason?.trim()) {
      problems.push(`${name}: no language rule and no exemption reason`);
    }
  }
  const known = new Set(names);
  for (const key of Object.keys(exempt)) {
    if (!known.has(key)) problems.push(`${key}: listed as exempt but is not a known agent`);
  }
  return problems;
}
