import { streamText, type SystemBlock } from "@book-forge/llm";
import type {
  CriticReport,
  GenerationConfig,
  IssueSeverity,
} from "@book-forge/shared";

const SYSTEM_REVISER = `Ты — Reviser. Перерабатываешь готовую главу художественной прозы на русском, опираясь на замечания критиков.

Правила:
— Выводишь ТОЛЬКО переписанный текст главы. Никаких служебных заголовков, списков замечаний, комментариев "что я изменил" — только проза.
— Сохраняешь POV, эмоциональную цель и сюжетные beats оригинала. Не переписываешь сюжет, только устраняешь обозначенные проблемы.
— Приоритет правок: blocking → suggestion → nit. Если два замечания противоречат друг другу, отдай приоритет замечанию с более высокой severity; при равной severity предпочти то, что подкреплено точной цитатой и конкретной выполнимой правкой.
— Не «улучшаешь» места которые критики не отмечали. Не вписывай новые сцены/реплики, не добавляй персонажей.
— Не теряй выразительные находки оригинала, если их не критиковали.
— Длина итогового текста — близко к оригиналу (±20%).
— Никаких LLM-клише: «казалось», «по сути», «не X, а Y», избытка списков из трёх.

Пиши прозу сразу. Без вступлений типа "Вот переработанная глава:".`;

export interface ReviseChapterInput {
  bookContext: string;
  chapterTitle: string;
  pov: string;
  emotionalGoal: string;
  /** Rendered accepted beat-sheet (optional) — beats the revision must preserve. */
  beatSheet?: string | null;
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

export async function* reviseChapter(
  input: ReviseChapterInput,
): AsyncGenerator<
  string,
  {
    text: string;
    modelId: string;
    tokens: {
      input: number;
      output: number;
      cacheCreation: number;
      cacheRead: number;
    };
  },
  void
> {
  const severityFilter = input.severityFilter ?? [
    "blocking",
    "suggestion",
    "nit",
  ];
  const issuesBlock = formatCriticIssues(input.critics, severityFilter);

  // Stable system: SYSTEM_REVISER + book context + previous summary +
  // characters + lore + style + fatigue. Volatile: chapter title/POV/goal +
  // critic issues + original text + task.
  const stableParts: string[] = [
    `Контекст книги:\n${input.bookContext}`,
  ];
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
  const stableSystem = `${SYSTEM_REVISER}\n\n---\n\n${stableParts.join("\n\n")}`;
  const system: SystemBlock[] = [
    { type: "text", text: stableSystem, cache_control: { type: "ephemeral" } },
  ];

  const volatileParts: string[] = [
    `Глава: "${input.chapterTitle}"`,
    `POV: ${input.pov}`,
    `Эмоциональная цель: ${input.emotionalGoal}`,
    ...(input.beatSheet
      ? [`Принятый beat-sheet главы (сохраняй эти beats):\n${input.beatSheet}`]
      : []),
    `Итерация repair: ${input.iteration}`,
    `Замечания критиков (приоритет blocking → suggestion → nit):\n${issuesBlock}`,
    `Оригинальная глава для переработки:\n\n${input.originalText}`,
    "Задача: перепиши главу, устранив указанные замечания. Выводи только прозу.",
  ];

  const gen = streamText({
    agentName: "editor",
    model: input.config?.model ?? "opus",
    system,
    prompt: volatileParts.join("\n\n"),
    ...(input.config?.temperature !== undefined
      ? { temperature: input.config.temperature }
      : {}),
    maxTokens: 16384,
  });

  let result = {
    text: "",
    modelId: "",
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
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
    tokens: {
      input: result.inputTokens,
      output: result.outputTokens,
      cacheCreation: result.cacheCreationInputTokens,
      cacheRead: result.cacheReadInputTokens,
    },
  };
}
