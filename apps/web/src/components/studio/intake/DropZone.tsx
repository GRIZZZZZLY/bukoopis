import { useRef, useState, type DragEvent } from "react";

export const ACCEPTED_EXTENSIONS = [".md", ".markdown", ".txt", ".docx"] as const;

interface Props {
  onFiles: (files: File[]) => void;
  busy: boolean;
  disabled?: boolean;
}

function isAccepted(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Приём материалов автора: перетаскивание папки или выбор файлов диалогом.
 *  Чтение и отправку делает родитель — здесь только отбор годных файлов. */
export function DropZone({ onFiles, busy, disabled = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);

  function take(list: FileList | File[] | null) {
    if (busy || disabled || !list) return;
    const all = Array.from(list);
    const good = all.filter((f) => isAccepted(f.name));
    setRejected(all.filter((f) => !isAccepted(f.name)).map((f) => f.name));
    if (good.length > 0) onFiles(good);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer?.files ?? null);
  }

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
          подходящее. Ничего не утверждается: всё ляжет черновиками на этапы.
        </p>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy || disabled}
          onClick={() => inputRef.current?.click()}
        >
          Выбрать файлы
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS.join(",")}
          className="hidden"
          onChange={(e) => take(e.target.files)}
        />
      </div>
      {rejected.length > 0 && (
        <p role="status" className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Пропущено, читать такое пока не умею: {rejected.join(", ")}
        </p>
      )}
    </div>
  );
}
