import type {
  AspectVariant,
  ContextRef,
  StageAspect,
  StageState,
} from "@book-forge/shared";
import type { StageDocumentSection } from "@/api/client";

/** Имена разделов — не канон сущностей: они живут внутри одного этапа, тёзок
 *  среди них не бывает, и падежей у них нет. Поэтому здесь достаточно
 *  регистра и краёв, а машинерия `entity-names` не нужна. */
export function normalizeSectionName(name: string): string {
  return name.trim().toLocaleLowerCase("ru");
}

/** Вариант, который сейчас показывается в документе: выбранный автором, иначе
 *  последний живой. Отвергнутые и вытесненные не в счёт — их автор уже прошёл. */
export function currentVariant(aspect: StageAspect): AspectVariant | null {
  if (aspect.selectedVariantId) {
    const picked = aspect.variants.find((v) => v.id === aspect.selectedVariantId);
    // Выбор не переживает вытеснения. Прежний экран при уточнении помечал
    // вариант `superseded`, НЕ снимая `selectedVariantId`, поэтому у разделов
    // мира и лора, заведённых до фазы 3, выбор указывает на мёртвый вариант.
    // Довериться ему значит показать автору старый текст, счесть раздел
    // заполненным (и не дописать его сборкой) и утвердить вместо нового.
    if (picked && picked.status !== "superseded" && picked.status !== "rejected") {
      return picked;
    }
  }
  for (let i = aspect.variants.length - 1; i >= 0; i -= 1) {
    const v = aspect.variants[i];
    if (!v) continue;
    if (v.status === "superseded" || v.status === "rejected") continue;
    return v;
  }
  return null;
}

/** Текст раздела или `null`, если его ещё нет. Принятый текст сильнее
 *  вариантов: он и есть то, что уходит в промпты. */
export function sectionText(aspect: StageAspect): string | null {
  if (typeof aspect.finalPayload === "string" && aspect.finalPayload.trim()) {
    return aspect.finalPayload;
  }
  const v = currentVariant(aspect);
  if (v && typeof v.payload === "string" && v.payload.trim()) return v.payload;
  return null;
}

/** Разделы собранного документа ложатся в состояние этапа.
 *
 *  Три правила, и все три — про то, что автор уже решил:
 *  · раздел с текстом не трогается вовсе (его версия модели выбрасывается);
 *  · пропущенный раздел не воскрешается;
 *  · пустой раздел с тем же именем наполняется, а не удваивается.
 *  Всё приходит в статусе `reviewing`: утверждает автор. */
export function mergeDocumentSections(
  stage: StageState,
  sections: StageDocumentSection[],
  meta: { contextRef: ContextRef; modelId: string },
): StageState {
  const now = new Date().toISOString();
  const byName = new Map<string, StageAspect>();
  for (const a of stage.aspects) byName.set(normalizeSectionName(a.name), a);

  let maxOrder = stage.aspects.reduce((m, a) => Math.max(m, a.order), -1);
  const updates = new Map<string, StageAspect>();
  const added: StageAspect[] = [];
  const handled = new Set<string>();

  for (const section of sections) {
    const key = normalizeSectionName(section.name);
    // Модель возвращает один раздел дважды чаще, чем кажется. Второй экземпляр
    // завёл бы рядом второй раздел с тем же именем — и тот навсегда остался бы
    // вне сопоставления по имени, потому что карта имён хранит только
    // последний. Берём первый, остальные выбрасываем.
    if (handled.has(key)) continue;
    handled.add(key);
    const variant: AspectVariant = {
      id: crypto.randomUUID(),
      label: "документ",
      payloadKind: "markdown",
      payload: section.markdown,
      status: "generated",
      editSource: "llm",
      generatedAt: now,
      modelId: meta.modelId,
      contextRef: meta.contextRef,
    };
    const existing = byName.get(key);
    if (!existing) {
      maxOrder += 1;
      added.push({
        id: crypto.randomUUID(),
        name: section.name,
        description: section.description,
        status: "reviewing",
        order: maxOrder,
        required: false,
        source: "llm",
        payloadKind: "markdown",
        variants: [variant],
      });
      continue;
    }
    if (existing.status === "skipped") continue;
    if (sectionText(existing) !== null) continue;
    updates.set(existing.id, {
      ...existing,
      status: "reviewing",
      ...(existing.description === undefined
        ? { description: section.description }
        : {}),
      variants: [...existing.variants, variant],
    });
  }

  if (updates.size === 0 && added.length === 0) return stage;

  return {
    ...stage,
    status: stage.status === "not_started" ? "in_progress" : stage.status,
    aspects: [
      ...stage.aspects.map((a) => updates.get(a.id) ?? a),
      ...added,
    ],
    updatedAt: now,
  };
}

/** «Утвердить этап»: каждый раздел, у которого есть текст, становится принятым.
 *  Пустые и пропущенные не трогаются — принять то, чего нет, значит соврать
 *  автору, что документ готов. `null` = принимать нечего. */
export function approveAllSections(stage: StageState): StageState | null {
  let changed = false;
  const aspects = stage.aspects.map((a) => {
    if (a.status === "skipped" || a.status === "accepted") return a;
    const chosen = currentVariant(a);
    if (!chosen || typeof chosen.payload !== "string" || !chosen.payload.trim()) {
      return a;
    }
    changed = true;
    return {
      ...a,
      status: "accepted" as const,
      selectedVariantId: chosen.id,
      finalPayload: chosen.payload,
      variants: a.variants.map((v) =>
        v.id === chosen.id
          ? { ...v, status: "accepted" as const }
          : v.status === "accepted"
            ? { ...v, status: "rejected" as const }
            : v,
      ),
    };
  });
  if (!changed) return null;
  return { ...stage, aspects, updatedAt: new Date().toISOString() };
}
