import { useRef, useState, type DragEvent } from "react";

export const ACCEPTED_EXTENSIONS = [".md", ".markdown", ".txt", ".docx"] as const;

/** Столько файлов принимает `POST /books/:id/intake` за раз. Папка легко
 *  перевешивает этот предел, а сервер ответил бы на такое голой ошибкой
 *  валидации — лучше сказать про это здесь, до отправки. */
const MAX_FILES = 50;

/** Потолок обхода: защита от папки, в которую случайно попал node_modules. */
const MAX_ENTRIES_VISITED = 5000;

/** Сколько имён показываем в списке пропущенного. Папка тащит за собой всё
 *  подряд — картинки, служебные файлы, — и полный список был бы простынёй. */
const MAX_LISTED = 8;

interface Props {
  onFiles: (files: File[]) => void;
  busy: boolean;
  disabled?: boolean;
}

/** То, что отдаёт `webkitGetAsEntry()`. Типы DOM описывают `FileSystemEntry`
 *  как абстракцию без `file`/`createReader`, а сужать его приходится вручную
 *  на каждом шаге — так что берём ровно ту форму, которой пользуемся. */
interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (cb: (f: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => {
    readEntries: (cb: (e: FsEntry[]) => void, err?: (e: unknown) => void) => void;
  };
}

function isAccepted(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function entryToFile(entry: FsEntry): Promise<File | null> {
  return new Promise((resolve) => {
    if (!entry.file) return resolve(null);
    entry.file(
      (f) => resolve(f),
      () => resolve(null),
    );
  });
}

function readBatch(reader: {
  readEntries: (cb: (e: FsEntry[]) => void, err?: (e: unknown) => void) => void;
}): Promise<FsEntry[]> {
  return new Promise((resolve) => {
    reader.readEntries(
      (e) => resolve(e),
      () => resolve([]),
    );
  });
}

/** Обходит перетащенные записи вширь и собирает обычные файлы. `readEntries`
 *  отдаёт содержимое папки порциями (Chrome — по сотне за раз) и сигналит
 *  концом через пустой ответ, поэтому один вызов на папку прочитал бы только
 *  начало. Ошибка на любой записи не роняет обход: файл просто не попадает в
 *  выборку, как и всё остальное нечитаемое. */
async function collectFiles(roots: FsEntry[]): Promise<File[]> {
  const out: File[] = [];
  const queue = [...roots];
  let visited = 0;
  while (queue.length > 0 && visited < MAX_ENTRIES_VISITED) {
    const entry = queue.shift()!;
    visited += 1;
    if (entry.isFile) {
      const f = await entryToFile(entry);
      if (f) out.push(f);
      continue;
    }
    if (!entry.isDirectory || !entry.createReader) continue;
    const reader = entry.createReader();
    for (;;) {
      const batch = await readBatch(reader);
      if (batch.length === 0) break;
      queue.push(...batch);
    }
  }
  return out;
}

function listNames(names: string[]): string {
  if (names.length <= MAX_LISTED) return names.join(", ");
  return `${names.slice(0, MAX_LISTED).join(", ")} и ещё ${names.length - MAX_LISTED}`;
}

/** Приём материалов автора: перетаскивание папки или выбор файлов диалогом.
 *  Чтение и отправку делает родитель — здесь только отбор годных файлов. */
export function DropZone({ onFiles, busy, disabled = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const [tooMany, setTooMany] = useState<number | null>(null);

  function take(list: FileList | File[] | null) {
    if (busy || disabled || !list) return;
    const all = Array.from(list);
    const good = all.filter((f) => isAccepted(f.name));
    setRejected(all.filter((f) => !isAccepted(f.name)).map((f) => f.name));
    if (good.length > MAX_FILES) {
      setTooMany(good.length);
      return;
    }
    setTooMany(null);
    if (good.length > 0) onFiles(good);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    if (busy || disabled) return;
    const dt = e.dataTransfer;
    if (!dt) return;

    // `webkitGetAsEntry()` надо позвать синхронно: после первого же await
    // браузер уже опустошил DataTransfer, и папка превращается в ничто.
    const entries: FsEntry[] = [];
    for (const item of Array.from(dt.items ?? [])) {
      const entry = (
        item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }
      ).webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }

    const plain = Array.from(dt.files ?? []);
    if (entries.length === 0) {
      take(plain);
      return;
    }
    void collectFiles(entries).then((files) =>
      // Пусто может быть и потому, что браузер не дал обойти папку, — тогда
      // берём то, что лежало в `files`, а не молчим.
      take(files.length > 0 ? files : plain),
    );
  }

  const hasNotice = rejected.length > 0 || tooMany !== null;

  return (
    <div className="intake-drop-wrap">
      <div
        className={"intake-drop" + (over ? " is-over" : "") + (busy ? " is-busy" : "")}
        aria-label="Перетащите файлы с материалами"
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy && !disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <p className="intake-drop-title">
          {busy ? "Разбираем материалы…" : "Перетащите сюда заметки и черновики"}
        </p>
        <p className="muted" style={{ fontSize: 12 }}>
          Файлы {ACCEPTED_EXTENSIONS.join(", ")}. Их можно бросить папкой — прочитается всё
          подходящее, вложенные папки тоже. Ничего не утверждается: всё ляжет черновиками на
          этапы.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy || disabled}
            onClick={() => inputRef.current?.click()}
          >
            Выбрать файлы
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy || disabled}
            onClick={() => dirInputRef.current?.click()}
          >
            Выбрать папку
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS.join(",")}
          className="hidden"
          onChange={(e) => take(e.target.files)}
        />
        <input
          // `webkitdirectory` в типах React нет, поэтому ставим атрибутом.
          // `accept` при нём игнорируется — папка приходит целиком, и лишнее
          // отсеивает `isAccepted`.
          ref={(el) => {
            dirInputRef.current = el;
            el?.setAttribute("webkitdirectory", "");
          }}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => take(e.target.files)}
        />
      </div>
      {hasNotice && (
        <div role="status" className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          {rejected.length > 0 && (
            <p>Пропущено, читать такое пока не умею: {listNames(rejected)}</p>
          )}
          {tooMany !== null && (
            <p>
              Слишком много файлов за раз: {tooMany}, а принять могу не больше {MAX_FILES}.
              Перетащите папку по частям.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
