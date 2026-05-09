import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * TipTap extension that paints non-persistent decorations on canon entity
 * mentions in the chapter text. The entity list is provided via the
 * `canonEntities` plugin meta — call `setCanonEntities(editor, list)` to
 * update without dispatching a transaction.
 *
 * Decorations are inline classes only (no DOM mutations), so they stay out of
 * the saved JSON.
 */

export type CanonHighlightKind =
  | "character"
  | "location"
  | "item"
  | "hook"
  | "relationship";

export interface CanonHighlightEntity {
  type: CanonHighlightKind;
  name: string;
  /** Stable id within type — used for click handlers if needed later. */
  id?: number;
}

const KEY = new PluginKey<DecorationSet>("canon-highlight");

interface CanonHighlightOptions {
  initial?: CanonHighlightEntity[];
}

export const CanonHighlight = Extension.create<CanonHighlightOptions>({
  name: "canonHighlight",

  addOptions() {
    return { initial: [] };
  },

  addProseMirrorPlugins() {
    let entities: CanonHighlightEntity[] = this.options.initial ?? [];

    return [
      new Plugin({
        key: KEY,
        state: {
          init: (_config, state) => buildDecorations(state, entities),
          apply: (tr, old, _oldState, newState) => {
            const meta = tr.getMeta("canonEntities") as
              | CanonHighlightEntity[]
              | undefined;
            if (meta) {
              entities = meta;
              return buildDecorations(newState, entities);
            }
            if (tr.docChanged) {
              return buildDecorations(newState, entities);
            }
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return KEY.getState(state) ?? null;
          },
        },
      }),
    ];
  },
});

function buildDecorations(
  state: EditorState,
  entities: CanonHighlightEntity[],
): DecorationSet {
  if (entities.length === 0) return DecorationSet.empty;
  // Collect names per kind. Keep longest names first so e.g. "Анна Каренина"
  // wins over "Анна".
  const sorted = [...entities].sort(
    (a, b) => b.name.trim().length - a.name.trim().length,
  );
  const decos: Decoration[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text;
    const claimed: Array<[number, number]> = [];
    for (const e of sorted) {
      const needle = e.name.trim();
      if (needle.length < 2) continue;
      const re = makeRegex(needle);
      if (!re) continue;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (overlaps(claimed, start, end)) continue;
        claimed.push([start, end]);
        decos.push(
          Decoration.inline(pos + start, pos + end, {
            class: `canon-mark canon-mark-${e.type}`,
            "data-canon-kind": e.type,
            "data-canon-name": e.name,
            ...(e.id !== undefined ? { "data-canon-id": String(e.id) } : {}),
          }),
        );
      }
    }
  });
  return DecorationSet.create(state.doc, decos);
}

function overlaps(
  claimed: Array<[number, number]>,
  s: number,
  e: number,
): boolean {
  for (const [cs, ce] of claimed) {
    if (s < ce && e > cs) return true;
  }
  return false;
}

const NEEDLE_CACHE = new Map<string, RegExp | null>();

function makeRegex(name: string): RegExp | null {
  if (NEEDLE_CACHE.has(name)) return NEEDLE_CACHE.get(name) ?? null;
  try {
    // Escape regex specials. Match as a separated word using lookarounds with
    // unicode letter/digit awareness.
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`,
      "giu",
    );
    NEEDLE_CACHE.set(name, re);
    return re;
  } catch {
    NEEDLE_CACHE.set(name, null);
    return null;
  }
}

/** Update entities without changing document content. */
export function setCanonEntities(
  editor: Editor,
  entities: CanonHighlightEntity[],
): void {
  const { state, view } = editor;
  const tr = state.tr.setMeta("canonEntities", entities);
  view.dispatch(tr);
}
