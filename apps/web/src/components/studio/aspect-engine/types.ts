import type { ReactNode } from "react";
import type { ZodType } from "zod";
import type {
  AspectVariant,
  PayloadKind,
  StageAspect,
  StageId,
} from "@book-forge/shared";
import type { AspectGenerationProgress } from "@/api/client";

/** Поведение, специфичное для сцены. Каждая сцена (мир/легенды/персонажи/предметы)
 *  предоставляет собственную реализацию. C1 поставляет только адаптер markdown для тестов;
 *  фазы D/E добавляют реальные адаптеры сцен. */
export interface StageAdapter<TPayload> {
  stageId: StageId;
  payloadKind: PayloadKind;
  /** Runtime guard для сохранённой полезной нагрузки. Защищает от отклонения после миграции
   *  или когда другие пути кода записывают в `studio_state` JSONB. */
  payloadSchema: ZodType<TPayload>;
  /** Отрендерить одну сгенерированную вариант (или уточнённый вариант) внутри runner. */
  renderVariant(payload: TPayload): ReactNode;
  /** Отрендеривать принятую окончательную полезную нагрузку. Может отличаться от рендера варианта
   *  (например, принятый markdown получит стиль прозы). */
  renderFinal(payload: TPayload): ReactNode;
  /** Есть только у сцен, где автор может набрать полезную нагрузку руками
   *  (markdown). Без него runner не показывает ручное редактирование. */
  editable?: {
    toText(payload: TPayload): string;
    fromText(text: string): TPayload;
  };
}

/** Интерфейс генератора вариантов. C1 поставляет mock-реализацию; C2 подключает
 *  генераторы на основе LLM. */
export interface VariantGenerator<TPayload> {
  /** `onProgress` опционален: генераторы без стрима его игнорируют. */
  generate(
    input: GenerateInput<TPayload>,
    onProgress?: (p: AspectGenerationProgress) => void,
  ): Promise<AspectVariant[]>;
}

export interface GenerateInput<TPayload> {
  aspect: StageAspect;
  accumulated: AccumulatedContext;
  /** Опциональный черновик от пользователя — передаётся для полей, которые позволяют seed-текст. */
  draft?: string;
  /** Если установлено, генератор просят уточнить ЭТОТ вариант полезной нагрузки (через
   *  инструкции пользователя) и произвести новый потомок варианта. */
  refineFrom?: { variantId: string; payload: TPayload; instructions: string };
}

/** Контекст, построенный из уже принятых аспектов в той же сцене, в `порядке`. */
export interface AccumulatedContext {
  acceptedAspects: Array<{
    id: string;
    name: string;
    finalPayload: unknown;
  }>;
}
