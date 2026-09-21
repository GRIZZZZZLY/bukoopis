import { Fragment, type ReactNode } from "react";

/**
 * Отрисовка markdown разделов Мастерской (ТЗ конвейера, фаза 6: «сырой markdown»
 * → «отрисованный»). Документы этапов пишет модель, и читаются они как текст:
 * заголовки, списки, абзацы, выделение. Больше в них не бывает.
 *
 * Своими руками, а не библиотекой: подмножество узкое, а любая библиотека
 * markdown тянет за собой разбор HTML — то есть `dangerouslySetInnerHTML` над
 * текстом, который пришёл от модели. Здесь же строятся узлы React, и вставить
 * разметку через них нельзя.
 */

interface Props {
  text: string;
  className?: string;
}

/** `**жирный**`, `*курсив*`, `` `код` `` — остальное остаётся текстом. */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const key = `${m.index}`;
    if (m[1] !== undefined) parts.push(<strong key={key}>{m[1]}</strong>);
    else if (m[2] !== undefined) parts.push(<em key={key}>{m[2]}</em>);
    else parts.push(<code key={key}>{m[3]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;

export function Markdown({ text, className }: Props) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  function flushParagraph(): void {
    if (paragraph.length === 0) return;
    blocks.push(
      <p key={`p${blocks.length}`}>{inline(paragraph.join(" "))}</p>,
    );
    paragraph = [];
  }
  function flushList(): void {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={`l${blocks.length}`}>{items}</ol>
      ) : (
        <ul key={`l${blocks.length}`}>{items}</ul>
      ),
    );
    list = null;
  }

  for (const line of lines) {
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1]!.length, 6);
      const Tag = `h${level}` as "h1";
      blocks.push(
        <Tag key={`h${blocks.length}`}>{inline(heading[2] ?? "")}</Tag>,
      );
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      const isOrdered = ordered !== null;
      // Смена вида списка начинает новый: «1.» под «-» — это два списка.
      if (list && list.ordered !== isOrdered) flushList();
      const item = (bullet?.[1] ?? ordered?.[1] ?? "").trim();
      list = list ?? { ordered: isOrdered, items: [] };
      list.items.push(item);
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();

  return (
    <div className={className ? `md ${className}` : "md"}>
      {blocks.map((b, i) => (
        <Fragment key={i}>{b}</Fragment>
      ))}
    </div>
  );
}
