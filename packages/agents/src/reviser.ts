import { streamText, type SystemBlock } from "@book-forge/llm";
import { renderHistoryBlocks } from "./critics/base.js";
import {
  issueIdFor,
  renderClicheRule,
  RU_DIALOGUE_RULE,
  STYLE_PRECEDENCE_RULE,
  type CriticReport,
  type GenerationConfig,
  type IssueSeverity,
} from "@book-forge/shared";

const SYSTEM_REVISER = `Ты — Reviser. Перерабатываешь готовую главу художественной прозы на русском, опираясь на замечания критиков.

Правила:
— Выводишь ТОЛЬКО переписанный текст главы. Никаких служебных заголовков, списков замечаний, комментариев "что я изменил" — только проза.
— Сохраняешь POV, эмоциональную цель и сюжетные beats оригинала. Не переписываешь сюжет, только устраняешь обозначенные проблемы.
— Приоритет правок: blocking → suggestion → nit. Если два замечания противоречат друг другу, отдай приоритет замечанию с более высокой severity; при равной severity предпочти то, что подкреплено точной цитатой и конкретной выполнимой правкой.
— Главное правило — минимальное вмешательство. Меняешь только то, на что указало замечание; удачные и нейтральные места оставляешь как есть, даже если их можно «улучшить». Не вписывай новые сцены и реплики, не добавляй персонажей.
— Удалить — законная правка. Избыточное пояснение, лишний образ, повтор можно просто убрать, ничего не вписывая взамен.
— Правка не делает текст образнее оригинала. Простое слово не заменяй выразительным синонимом; удалённое украшение не компенсируй новым сравнением или метафорой.
— Не теряй находки оригинала, если их не критиковали.
— Длина итогового текста — близко к оригиналу (±20%); после удалений текст вправе стать короче.
— Не объясняй тему и иронию словами нарратора и не добавляй герою итогового понимания. Если такое объяснение есть в оригинале и его отметили — убирай, не переписывай другими словами.
— Не добавляй рефлексии и не удлиняй финал.
— Финал главы (если он назван в блоке beat-sheet) сохраняй по форме: обрыв остаётся обрывом, открытый финал не закрывается, внешнее действие не заменяется внутренним принятием. Последнюю фразу не делай выразительнее, чем она была.
— Обычные фразы, простые связующие предложения, необъяснённые детали и незакрытые хвосты — не дефекты.
${renderClicheRule()}
${RU_DIALOGUE_RULE}

${STYLE_PRECEDENCE_RULE}

Пиши прозу сразу. Без вступлений типа "Вот переработанная глава:".`;

export interface ReviseChapterInput {
  bookContext: string;
  chapterTitle: string;
  pov: string;
  emotionalGoal: string;
  /** Rendered accepted beat-sheet (optional) — beats the revision must preserve. */
  beatSheet?: string | null;
  /**
   * Rendered narrative architecture sheet of the selected outline. Repair is
   * the last pass over the prose, so it is the last place a structural
   * decision (partial ending, withheld theme) can be quietly undone.
   */
  architectureContext?: string | null;
  /** Контракт главы (слайс 4.5). Правка — последний проход по прозе, и
   *  замечание критика вполне может предложить убрать то, что план объявил
   *  обязательным, или дописать запрещённое: критик видит текст, а не план. */
  chapterContract?: string | null;
  characterContext: string | null;
  loreContext: string | null;
  styleContext: string | null;
  fatigueWords: string[];
  previousChaptersSummary: string | null;
  /** Та же история, что у Writer и критиков (AC-36): финал предыдущей главы
   *  дословно и найденные фрагменты. Правка — последний проход по прозе, и
   *  без них она могла «починить» стык с предыдущей главой, которого не
   *  видела. */
  previousChapterTail?: string | null;
  /** Анкета непрерывности предыдущей главы — та же, что у Писателя. */
  sceneState?: string | null;
  retrievedContext?: string | null;
  originalText: string;
  critics: CriticReport[];
  severityFilter?: IssueSeverity[]; // default: all
  /** Только эти замечания (этап 5, AC-29). Сильнее `severityFilter`: автор
   *  показал пальцем, а не задал порог. */
  selectedIssueIds?: string[];
  /** Куски, которых правка не касается. Сервер уже проверил, что каждый
   *  встречается в тексте версии ровно один раз. */
  protectedFragments?: string[];
  iteration: number; // 1, 2, 3
  config?: GenerationConfig;
  /** Отмена вызова (task 7 — остановка генерации). */
  signal?: AbortSignal;
}

function formatCriticIssues(
  critics: CriticReport[],
  severityFilter: IssueSeverity[],
  selectedIssueIds?: readonly string[],
): string {
  const order: IssueSeverity[] = ["blocking", "suggestion", "nit"];
  // Выбор автора сильнее фильтра по серьёзности: он показал пальцем именно на
  // эти замечания, и отсекать их порогом значит спорить с ним.
  const selected = selectedIssueIds ? new Set(selectedIssueIds) : null;
  const lines: string[] = [];
  for (const sev of order) {
    if (!selected && !severityFilter.includes(sev)) continue;
    const all: { critic: string; issue: CriticReport["issues"][number] }[] = [];
    for (const c of critics) {
      c.issues.forEach((issue, index) => {
        if (issue.severity !== sev) return;
        if (selected && !selected.has(issueIdFor(c.critic, index))) return;
        all.push({ critic: c.critic, issue });
      });
    }
    if (all.length === 0) continue;
    lines.push(`## ${sev.toUpperCase()} (${all.length}):`);
    for (const { critic, issue } of all) {
      lines.push(`- [${critic}] ${issue.summary}`);
      if (issue.excerpt) lines.push(`  Цитата: «${issue.excerpt}»`);
      if (issue.suggestion) lines.push(`  Правка: ${issue.suggestion}`);
    }
  }
  return lines.join("\n");
}

/**
 * Stable half of the Reviser system prompt — rules, book context, memory
 * layers, style. Extracted so prompt composition is directly testable.
 */
export function buildReviserStableSystem(input: ReviseChapterInput): string {
  const stableParts: string[] = [`Контекст книги:\n${input.bookContext}`];
  if (input.architectureContext) {
    stableParts.push(
      `Архитектура книги (решения Plot Agent, правка не должна их менять):\n${input.architectureContext}`,
    );
  }
  if (input.chapterContract) {
    stableParts.push(
      `${input.chapterContract}\n\nКонтракт сильнее замечаний: не убирай обязательное и не вписывай запрещённое, даже если замечание критика этого просит.`,
    );
  }
  stableParts.push(...renderHistoryBlocks(input));
  if (input.characterContext) stableParts.push(input.characterContext);
  if (input.loreContext) stableParts.push(input.loreContext);
  if (input.styleContext) stableParts.push(input.styleContext);
  if (input.fatigueWords.length > 0) {
    stableParts.push(
      `Слова и обороты с повышенной частотой — не злоупотребляй ими. Единичное употребление допустимо, если оно естественно и не создаёт повтора рядом:\n- ${input.fatigueWords.join("\n- ")}`,
    );
  }
  return `${SYSTEM_REVISER}\n\n---\n\n${stableParts.join("\n\n")}`;
}

/** Volatile half — chapter, critic issues, original text, task. */
export function buildReviserVolatilePrompt(input: ReviseChapterInput): string {
  const severityFilter = input.severityFilter ?? [
    "blocking",
    "suggestion",
    "nit",
  ];
  return [
    `Глава: "${input.chapterTitle}"`,
    `POV: ${input.pov}`,
    `Эмоциональная цель: ${input.emotionalGoal}`,
    ...(input.beatSheet
      ? [`Принятый beat-sheet главы (сохраняй эти beats):\n${input.beatSheet}`]
      : []),
    `Итерация repair: ${input.iteration}`,
    input.selectedIssueIds && input.selectedIssueIds.length > 0
      ? `Замечания, выбранные автором — правь ТОЛЬКО это, остального он не просил:\n${formatCriticIssues(input.critics, severityFilter, input.selectedIssueIds)}`
      : `Замечания критиков (приоритет blocking → suggestion → nit):\n${formatCriticIssues(input.critics, severityFilter)}`,
    ...(input.protectedFragments && input.protectedFragments.length > 0
      ? [
          `Защищённые фрагменты — перенеси их в результат ДОСЛОВНО, символ в символ, и не трогай:\n${input.protectedFragments
            .map((f) => `- «${f}»`)
            .join("\n")}\nЕсли замечание требует изменить защищённый фрагмент, оставь фрагмент как есть, а замечание не выполняй.`,
        ]
      : []),
    `Оригинальная глава для переработки:\n\n${input.originalText}`,
    "Задача: перепиши главу, устранив указанные замечания. Выводи только прозу.",
  ].join("\n\n");
}

export async function* reviseChapter(
  input: ReviseChapterInput,
): AsyncGenerator<
  string,
  {
    text: string;
    modelId: string;
    stopReason: string | null;
    tokens: {
      input: number;
      output: number;
      cacheCreation: number;
      cacheRead: number;
    };
  },
  void
> {
  const system: SystemBlock[] = [
    {
      type: "text",
      text: buildReviserStableSystem(input),
      cache_control: { type: "ephemeral" },
    },
  ];

  const gen = streamText({
    agentName: "editor",
    model: input.config?.model ?? "opus",
    system,
    prompt: buildReviserVolatilePrompt(input),
    ...(input.config?.temperature !== undefined
      ? { temperature: input.config.temperature }
      : {}),
    maxTokens: 16384,
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
  });

  let result = {
    text: "",
    modelId: "",
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    stopReason: null as string | null,
  };
  while (true) {
    const next = await gen.next();
    if (next.done) {
      result = next.value;
      break;
    }
    yield next.value;
  }

  return {
    text: result.text,
    modelId: result.modelId,
    stopReason: result.stopReason,
    tokens: {
      input: result.inputTokens,
      output: result.outputTokens,
      cacheCreation: result.cacheCreationInputTokens,
      cacheRead: result.cacheReadInputTokens,
    },
  };
}
