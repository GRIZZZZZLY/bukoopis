import type { Database as DatabaseType } from "better-sqlite3";
import {
  bookOutlineSchema,
  renderOutlineChapterIntent,
  type OutlineChapter,
} from "@book-forge/shared";

export type PlanApproveReason = "no_outline" | "no_selection" | "no_chapters";

export class PlanApproveError extends Error {
  constructor(
    public readonly reason: PlanApproveReason,
    message: string,
  ) {
    super(message);
    this.name = "PlanApproveError";
  }
}

export interface ApprovePlanResult {
  created: number;
  updated: number;
}

/** Превращает выбранный вариант плана в главы.
 *
 *  Сопоставление — строго по порядку: первая строка плана к первой главе,
 *  вторая ко второй. Совпадать по названию было бы соблазнительно и неверно:
 *  автор переименовывает главы, а план — нет, и одно переименование рассыпало
 *  бы всё сопоставление.
 *
 *  Что не делается никогда: не меняется название существующей главы (её назвал
 *  автор), не трогается текст, не удаляются главы, которых в плане больше нет.
 *  Утверждение плана — это про намерения, а не про уборку. */
export function approvePlan(
  sqlite: DatabaseType,
  bookId: number,
): ApprovePlanResult {
  const row = sqlite
    .prepare("SELECT outline_json FROM books WHERE id = ?")
    .get(bookId) as { outline_json: string | null } | undefined;
  if (!row?.outline_json) {
    throw new PlanApproveError("no_outline", "у книги ещё нет плана");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(row.outline_json);
  } catch {
    throw new PlanApproveError("no_outline", "план не читается");
  }
  const parsed = bookOutlineSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PlanApproveError("no_outline", "план не читается");
  }
  const outline = parsed.data;
  if (outline.selectedIndex === null) {
    throw new PlanApproveError("no_selection", "вариант плана не выбран");
  }
  const variant = outline.variants[outline.selectedIndex];
  if (!variant) {
    throw new PlanApproveError("no_selection", "выбранного варианта нет в плане");
  }
  const rows: OutlineChapter[] = variant.chapters ?? [];
  if (rows.length === 0) {
    throw new PlanApproveError(
      "no_chapters",
      "в выбранном варианте нет поглавного плана",
    );
  }

  const tx = sqlite.transaction((): ApprovePlanResult => {
    const existing = sqlite
      .prepare(
        "SELECT id, order_index FROM chapters WHERE book_id = ? ORDER BY order_index ASC, id ASC",
      )
      .all(bookId) as Array<{ id: number; order_index: number }>;

    const now = new Date().toISOString();
    const updateIntent = sqlite.prepare(
      "UPDATE chapters SET intent = ?, updated_at = ? WHERE id = ?",
    );
    const insertChapter = sqlite.prepare(
      `INSERT INTO chapters (book_id, order_index, title, intent, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?)`,
    );

    // Продолжаем ту же разрежённую нумерацию, что и остальные пути создания
    // глав: следующий индекс — максимум плюс десять.
    const max = sqlite
      .prepare("SELECT MAX(order_index) as m FROM chapters WHERE book_id = ?")
      .get(bookId) as { m: number | null };
    let nextOrder = (max.m ?? 0) + 10;

    let created = 0;
    let updated = 0;
    for (let i = 0; i < rows.length; i++) {
      const planRow = rows[i]!;
      const intent = renderOutlineChapterIntent(planRow);
      const match = existing[i];
      if (match) {
        updateIntent.run(intent, now, match.id);
        updated++;
      } else {
        insertChapter.run(bookId, nextOrder, planRow.title, intent, now, now);
        nextOrder += 10;
        created++;
      }
    }
    sqlite.prepare("UPDATE books SET updated_at = ? WHERE id = ?").run(now, bookId);
    return { created, updated };
  });
  return tx.immediate();
}
