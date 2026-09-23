import type { StageStatus } from "@book-forge/shared";

const LABEL: Record<StageStatus, string> = {
  complete: "готов",
  in_progress: "в работе",
  skipped: "пропущен",
  not_started: "не начат",
};

export function stageStatusLabel(status: StageStatus): string {
  return LABEL[status];
}

/** Точка статуса: закрашена — готов/в работе, кольцо — пропущен/не начат. */
export function StageStatusDot({ status }: { status: StageStatus }) {
  return <span className={`sdot sdot-${status}`} aria-hidden="true" />;
}

/** «none» — у главы нет сохранённой версии: только план или черновик
 *  из разбора, который автор ещё не сохранил. */
export type ChapterState = "final" | "in_review" | "draft" | "none";

const CHAPTER_LABEL: Record<ChapterState, string> = {
  final: "готова",
  in_review: "на проверке",
  draft: "черновик",
  none: "без версии",
};

export function chapterStateLabel(state: ChapterState): string {
  return CHAPTER_LABEL[state];
}

export function ChapterStateDot({ state }: { state: ChapterState }) {
  return <span className={`cdot cdot-${state}`} aria-hidden="true" />;
}

export function chapterState(ch: { status: string; currentVersionId: number | null }): ChapterState {
  if (ch.status === "final") return "final";
  if (ch.status === "in_review") return "in_review";
  return ch.currentVersionId === null ? "none" : "draft";
}
