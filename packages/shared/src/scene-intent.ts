import { z } from "zod";

/**
 * Замысел сцены (ТЗ индивидуальности, раздел 9.2).
 *
 * Что герой хочет в ЭТОЙ сцене, на что смотрит, о чём молчит и где его
 * граница. Не реплики, не обязательный внутренний монолог и не новый канон:
 * намерение — это то, из чего герой действует, а не то, что с ним случилось.
 * Пережитым событием оно не становится никогда — память по-прежнему
 * извлекается из принятого текста.
 *
 * Две схемы, как у профиля персонажа V2 и у плана главы: схема ЧТЕНИЯ без
 * пределов длины (строка из базы не должна ронять главу) и схема ОТВЕТА
 * МОДЕЛИ с пределами (превышение значит, что модель не поняла контракт).
 */

/** Ключ сцены. Отдельной таблицы сцен в проекте нет, и этап 5 её не заводит:
 *  сцена пока одна на главу (AC-08 отложен вместе с внутриглавными сценами),
 *  поэтому ключ синтетический — глава и порядковый номер сцены. */
export function sceneKeyFor(chapterId: number, sceneOrdinal: number): string {
  return `${chapterId}:${sceneOrdinal}`;
}

const readLine = z.string().nullable();
const readList = z.array(z.string());

export const sceneIntentParticipantSchema = z.object({
  characterId: z.number().int().positive(),
  /** Чего герой хочет добиться в этой сцене. `null` — сцена не требует цели:
   *  бывает совместная работа, скука и бытовой разговор. */
  immediateGoal: readLine,
  /** На что он смотрит и что замечает. */
  attentionFocus: readList,
  /** О чём молчит, хотя знает. */
  withheld: readList,
  /** Как добивается своего: просит, давит, обходит, торгуется. */
  influenceStrategy: readLine,
  /** Чем готов поступиться. */
  concessions: readList,
  /** Чего не сделает. */
  boundaries: readList,
  /** Ссылки на строки `character_events`. Сервер сверяет их со снимком: модель
   *  не вправе сослаться на несуществующее или будущее знание (AC-25). */
  relevantEventIds: z.array(z.number().int().positive()),
});
export type SceneIntentParticipant = z.infer<typeof sceneIntentParticipantSchema>;

export const sceneIntentTensionSchema = z.object({
  fromCharacterId: z.number().int().positive(),
  toCharacterId: z.number().int().positive(),
  subject: z.string(),
});
export type SceneIntentTension = z.infer<typeof sceneIntentTensionSchema>;

export const sceneIntentSchema = z.object({
  sceneId: z.string(),
  /** `context_manifests.id` сборки, из которой замысел собран. Второго
   *  хранилища снимков не заводим — манифест этапа 4 и есть снимок. */
  contextSnapshotId: z.number().int().positive(),
  participants: z.array(sceneIntentParticipantSchema),
  /** Пустой список — валидный ответ: сцене не обязан быть нужен конфликт. */
  interactionTensions: z.array(sceneIntentTensionSchema),
});
export type SceneIntent = z.infer<typeof sceneIntentSchema>;

const toolLine = z.string().max(400).nullable();
const toolList = z.array(z.string().max(300)).max(6);

export const sceneIntentToolSchema = z
  .object({
    participants: z
      .array(
        z.object({
          characterId: z.number().int().positive(),
          immediateGoal: toolLine,
          attentionFocus: toolList,
          withheld: toolList,
          influenceStrategy: toolLine,
          concessions: toolList,
          boundaries: toolList,
          relevantEventIds: z.array(z.number().int().positive()).max(20),
        }),
      )
      .min(1)
      .max(12),
    interactionTensions: z
      .array(
        z.object({
          fromCharacterId: z.number().int().positive(),
          toCharacterId: z.number().int().positive(),
          subject: z.string().max(300),
        }),
      )
      .max(20),
  })
  // `sceneId` и `contextSnapshotId` ставит сервер. Приняв их от модели, мы
  // позволили бы ей назвать чужой снимок — а по нему как раз и проверяются
  // ссылки на события.
  .strict();
export type SceneIntentToolResult = z.infer<typeof sceneIntentToolSchema>;

function renderList(label: string, items: readonly string[]): string | null {
  const kept = items.map((s) => s.trim()).filter((s) => s.length > 0);
  if (kept.length === 0) return null;
  return `${label}: ${kept.join("; ")}`;
}

/**
 * Замысел сцены для промпта Писателя. Имена, а не номера: номер герою ничего
 * не говорит, а карточка рядом подписана именем.
 *
 * Пустые подсписки не печатаются: заголовок без строк читается как
 * утверждение («границ нет»), то же правило, что у контракта главы.
 * Участник, которого нет среди известных имён, пропускается — карточки у него
 * в промпте всё равно нет, и намерение висело бы в пустоте.
 */
export function renderSceneIntentPrompt(
  intent: SceneIntent,
  names: ReadonlyMap<number, string>,
): string | null {
  const blocks: string[] = [];
  for (const p of intent.participants) {
    const name = names.get(p.characterId);
    if (!name) continue;
    const lines: string[] = [];
    if (p.immediateGoal?.trim()) lines.push(`Хочет в этой сцене: ${p.immediateGoal.trim()}`);
    if (p.influenceStrategy?.trim()) lines.push(`Добивается так: ${p.influenceStrategy.trim()}`);
    const rest = [
      renderList("Внимание", p.attentionFocus),
      renderList("Умалчивает", p.withheld),
      renderList("Готов уступить", p.concessions),
      renderList("Не сделает", p.boundaries),
    ].filter((s): s is string => s !== null);
    lines.push(...rest);
    if (lines.length === 0) continue;
    blocks.push(`${name}\n${lines.map((l) => `— ${l}`).join("\n")}`);
  }
  if (blocks.length === 0) return null;

  const tensions = intent.interactionTensions
    .map((t) => {
      const from = names.get(t.fromCharacterId);
      const to = names.get(t.toCharacterId);
      if (!from || !to || !t.subject.trim()) return null;
      return `— ${from} → ${to}: ${t.subject.trim()}`;
    })
    .filter((s): s is string => s !== null);

  const parts = [`Замысел сцены:\n\n${blocks.join("\n\n")}`];
  if (tensions.length > 0) parts.push(`Напряжения:\n${tensions.join("\n")}`);
  return parts.join("\n\n");
}
