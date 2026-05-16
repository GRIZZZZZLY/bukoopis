import type { StageId } from "@book-forge/shared";

/** Single source of truth for stage → URL mapping in the web app. */
export function stageRoute(bookId: number, stageId: StageId): string {
  if (stageId === "concept") return `/books/${bookId}/studio`;
  if (stageId === "chapters") return `/books/${bookId}/studio/chapters`;
  // world | lore | plot | characters | items
  return `/books/${bookId}/studio/${stageId}`;
}
