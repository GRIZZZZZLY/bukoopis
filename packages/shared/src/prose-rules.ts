// Shared prose rules injected into every prose-producing agent (writer,
// reviser, inline). Previously each agent carried its own hand-written copy of
// the LLM-cliché list and they drifted apart; the fatigue baseline in
// style-engine drifted too. One source, three consumers.

/** Lexical tells that mark machine-written Russian prose. */
export const LLM_CLICHE_TOKENS_RU = [
  "казалось",
  "по сути",
  "в действительности",
  "в каком-то смысле",
  "определённый",
  "весьма",
  "буквально",
  "невероятно",
  "поистине",
] as const;

/** Structural tells — patterns rather than words. */
export const LLM_CLICHE_PATTERNS_RU = [
  "«не X, а Y» и «не только X, но и Y»",
  "избыток перечислений из трёх однородных членов",
  "симметричные зеркальные предложения подряд",
  "дублирование действия и его эмоции в соседних фразах («он улыбнулся, выражая радость»)",
  "шаблонные телесные метафоры («сердце замерло», «мурашки по коже», «глаза заблестели»)",
] as const;

/**
 * Rendered rule block for a system prompt. Kept as a function so the caller
 * chooses the surrounding heading and the list stays in one place.
 */
export function renderClicheRule(): string {
  return [
    `— Никаких LLM-клише. Слова-маркеры: ${LLM_CLICHE_TOKENS_RU.join(", ")}.`,
    `  Конструкции-маркеры: ${LLM_CLICHE_PATTERNS_RU.join("; ")}.`,
  ].join("\n");
}

/**
 * Russian dialogue punctuation. Models trained mostly on English default to
 * quotation marks and drop the dash, which reads as a translation artefact.
 */
export const RU_DIALOGUE_RULE = `— Прямая речь оформляется по-русски: реплика с новой строки через тире («— Уходи, — сказал он.»), не кавычками. Кавычки-«ёлочки» — только для цитат, названий и внутренней речи.`;

/**
 * Precedence rule for agents that receive a style fingerprint. Without it the
 * default "clear prose, few metaphors" guidance silently overrides an author
 * style that is deliberately dense or ornate.
 */
export const STYLE_PRECEDENCE_RULE = `Если ниже есть блок «Стиль» (профиль автора), он имеет приоритет над общими стилевыми правилами выше: следуй его ритму, плотности метафор и синтаксису, даже если они расходятся с дефолтными установками. Запрет на LLM-клише и требования к оформлению диалога остаются в силе всегда.`;
