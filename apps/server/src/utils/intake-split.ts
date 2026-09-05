/** Классификатор echo-ит текст автора дословно внутри бюджета `maxTokens:
 *  32000`, а русский идёт примерно по 2–2.5 символа на токен — файл заметно
 *  крупнее этого предела переполняет вызов целиком, а не обрезается. Поэтому
 *  большой файл не отвергается, а режется на части: авторская «библия» на 48
 *  тысяч символов — не исключение, а норма материала, ради которого интейк и
 *  существует. */
export const MAX_INTAKE_FILE_CHARS = 40_000;

export interface IntakeUnit {
  /** Имя, под которым часть видна автору и уходит классификатору. У целого
   *  файла совпадает с исходным; у части несёт «(часть N из M)». */
  filename: string;
  content: string;
}

/** Абзац длиннее предела резать по границе нечего — рубим по символам. Такой
 *  абзац означает текст без переводов строки вовсе (или одну гигантскую
 *  таблицу), и потерять его целиком было бы хуже, чем разорвать по живому. */
function cutOversizedLine(line: string, max: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < line.length; i += max) out.push(line.slice(i, i + max));
  return out;
}

/** Режет текст на куски не длиннее `max`, по границам строк. Абзацы не
 *  перемешиваются и не теряются: конкатенация кусков через `\n` даёт исходный
 *  текст (с точностью до пустых хвостов). */
export function splitIntakeText(content: string, max: number): string[] {
  if (content.length <= max) return [content];

  const chunks: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur.length > 0) {
      chunks.push(cur);
      cur = "";
    }
  };

  for (const line of content.split("\n")) {
    const pieces = line.length > max ? cutOversizedLine(line, max) : [line];
    for (const piece of pieces) {
      // Разделитель считается вместе с куском: иначе кусок, влезающий ровно в
      // предел, вылезал бы за него на один символ переноса.
      const addition = cur.length === 0 ? piece : "\n" + piece;
      if (cur.length + addition.length > max) {
        flush();
        cur = piece;
      } else {
        cur += addition;
      }
    }
  }
  flush();

  // Текст длиннее предела, но состоящий из одних пустых строк, не даёт ни
  // одного куска — отдаём его как есть, пусть отказ придёт от классификатора,
  // а не от молчаливой потери файла.
  return chunks.length > 0 ? chunks : [content];
}

/** Один файл — одна или несколько единиц разбора. Целый файл сохраняет своё
 *  имя (и, значит, свой ключ в журнале — старые записи продолжают совпадать);
 *  разрезанный получает по имени на часть, чтобы и прогресс, и отказ, и
 *  дочитывание после остановки говорили про конкретную часть. */
export function splitIntakeFile(
  file: { filename: string; content: string },
  max: number = MAX_INTAKE_FILE_CHARS,
): IntakeUnit[] {
  const parts = splitIntakeText(file.content, max);
  if (parts.length === 1) return [{ filename: file.filename, content: parts[0]! }];
  return parts.map((content, i) => ({
    filename: `${file.filename} (часть ${i + 1} из ${parts.length})`,
    content,
  }));
}
