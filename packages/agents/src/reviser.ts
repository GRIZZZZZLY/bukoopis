import { streamText, type SystemBlock } from "@book-forge/llm";
import {
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
— Не «улучшаешь» места которые критики не отмечали. Не вписывай новые сцены/реплики, не добавляй персонажей.
— Не теряй выразительные находки оригинала, если их не критиковали.
— Длина итогового текста — близко к оригиналу (±20%).
— Не объясняй тему и иронию словами нарратора и не добавляй герою итогового понимания. Если такое объяснение есть в оригинале и его отметили — убирай, не переписывай другими словами.
— Не добавляй рефлексию: после кульминации не более одного абзаца осмысления, последний абзац — действие, реплика или образ. Правка не должна удлинять финал.
— Финал главы (если он назван в блоке beat-sheet) сохраняй по форме: обрыв остаётся обрывом, открытый финал не закрывается, внешнее действие не заменяется внутренним принятием.
— Сохраняй разницу регистров между сценами: не выравнивай длину предложений и плотность описаний по всей главе.
— Оставляй слабину: обычные фразы, необъяснённые детали и незакрытые хвосты — не дефекты. Не доводи каждое предложение до ударного и не превращай каждый абзац в короткую точную концовку.
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
  characterContext: string | null;
  loreContext: string | null;
  styleContext: string | null;
  fatigueWords: string[];
  previousChaptersSummary: string | null;
  originalText: string;
  critics: CriticReport[];
  severityFilter?: IssueSeverity[]; // default: all
  iteration: number; // 1, 2, 3
  config?: GenerationConfig;
  /** Отмена вызова (task 7 — остановка генерации). */
  signal?: AbortSignal;
}

function formatCriticIssues(
  critics: CriticReport[],
  severityFilter: IssueSeverity[],
): string {
  const order: IssueSeverity[] = ["blocking", "suggestion", "nit"];
  const lines: string[] = [];
  for (const sev of order) {
    if (!severityFilter.includes(sev)) continue;
    const all: { critic: string; issue: CriticReport["issues"][number] }[] = [];
    for (const c of critics) {
      for (const issue of c.issues) {
        if (issue.severity === sev) {
          all.push({ critic: c.critic, issue });
        }
      }
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
  if (input.previousChaptersSummary) {
    stableParts.push(
      `Предыдущие главы (краткое):\n${input.previousChaptersSummary}`,
    );
  }
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
    `Замечания критиков (приоритет blocking → suggestion → nit):\n${formatCriticIssues(input.critics, severityFilter)}`,
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
