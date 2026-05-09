import type { Database as DatabaseType } from "better-sqlite3";
import {
  locationProfileSchema,
  itemProfileSchema,
  type Hook,
  type HookStatus,
  type Item,
  type Location,
} from "@book-forge/shared";

interface LocationRow {
  id: number;
  book_id: number;
  name: string;
  profile_json: string;
  created_at: string;
  updated_at: string;
}
interface ItemRow {
  id: number;
  book_id: number;
  name: string;
  profile_json: string;
  created_at: string;
  updated_at: string;
}
interface HookRow {
  id: number;
  book_id: number;
  seed_chapter_id: number | null;
  description: string;
  status: string;
  expected_resolution_chapter_order: number | null;
  created_at: string;
  updated_at: string;
}

function rowToLocation(r: LocationRow): Location {
  return {
    id: r.id,
    bookId: r.book_id,
    name: r.name,
    profile: locationProfileSchema.parse(JSON.parse(r.profile_json)),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function rowToItem(r: ItemRow): Item {
  return {
    id: r.id,
    bookId: r.book_id,
    name: r.name,
    profile: itemProfileSchema.parse(JSON.parse(r.profile_json)),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function rowToHook(r: HookRow): Hook {
  return {
    id: r.id,
    bookId: r.book_id,
    seedChapterId: r.seed_chapter_id,
    description: r.description,
    status: r.status as HookStatus,
    expectedResolutionChapterOrder: r.expected_resolution_chapter_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface LoreAgentResult {
  locations: Location[];
  items: Item[];
  openHooks: Hook[];
}

export function gatherLoreContext(
  sqlite: DatabaseType,
  bookId: number,
  texts: Array<string | null | undefined>,
  currentChapterOrder?: number,
): LoreAgentResult {
  const blob = texts.filter(Boolean).join("\n").toLowerCase();

  const allLocations = sqlite
    .prepare("SELECT * FROM locations WHERE book_id = ?")
    .all(bookId) as LocationRow[];
  const locations = allLocations
    .filter((l) => blob.includes(l.name.toLowerCase()))
    .map(rowToLocation);

  const allItems = sqlite
    .prepare("SELECT * FROM items WHERE book_id = ?")
    .all(bookId) as ItemRow[];
  const items = allItems
    .filter((i) => blob.includes(i.name.toLowerCase()))
    .map(rowToItem);

  // Open hooks always returned (writer should weave them in / keep them alive).
  // Filter by expected_resolution_chapter_order: only show hooks expected at or
  // before the current chapter.
  const hooksBase = sqlite
    .prepare(
      `SELECT * FROM hooks
       WHERE book_id = ? AND status IN ('open','mentioned')
       ORDER BY created_at ASC`,
    )
    .all(bookId) as HookRow[];
  const openHooks = hooksBase
    .filter((h) => {
      if (currentChapterOrder === undefined) return true;
      if (h.expected_resolution_chapter_order === null) return true;
      return h.expected_resolution_chapter_order >= currentChapterOrder;
    })
    .map(rowToHook);

  return { locations, items, openHooks };
}

export function loreContextToPrompt(result: LoreAgentResult): string {
  const lines: string[] = [];
  if (result.locations.length > 0) {
    lines.push("## Локации");
    for (const l of result.locations) {
      lines.push(`### ${l.name}`);
      lines.push(`- ${l.profile.description}`);
      if (l.profile.atmosphere)
        lines.push(`- Атмосфера: ${l.profile.atmosphere}`);
    }
  }
  if (result.items.length > 0) {
    lines.push("\n## Артефакты / предметы");
    for (const i of result.items) {
      lines.push(`### ${i.name}`);
      lines.push(`- ${i.profile.description}`);
      if (i.profile.significance)
        lines.push(`- Значение: ${i.profile.significance}`);
    }
  }
  if (result.openHooks.length > 0) {
    lines.push("\n## Открытые сюжетные крючки");
    lines.push(
      "(нерешённые линии — поддерживай их живыми, не закрывай без необходимости)",
    );
    for (const h of result.openHooks) {
      lines.push(`- [${h.status}] ${h.description}`);
    }
  }
  return lines.join("\n");
}
