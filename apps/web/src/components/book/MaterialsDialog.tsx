import { useEffect, useRef, useState } from "react";
import { IntakePanel } from "@/components/studio/intake/IntakePanel";
import { ImportChaptersPanel } from "@/components/ImportExportPanel";

type Mode = "import" | "intake";

interface Props {
  bookId: number;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

/** Единственный вход для текста в книгу. Два режима: готовые главы без
 *  модели и разбор моделью. Диалог не размонтируется при закрытии: разбор
 *  идёт минутами, «Свернуть в фон» просто прячет окно, а поток и прогресс
 *  остаются в IntakePanel. */
export function MaterialsDialog({ bookId, open, onClose, onChanged }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<Mode>("intake");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // jsdom не умеет showModal — там диалог просто открывается атрибутом.
    if (open && !el.open) {
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
    } else if (!open && el.open) {
      if (typeof el.close === "function") el.close();
      else el.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="materials"
      aria-labelledby="materials-title"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="materials-head">
        <div>
          <h2 id="materials-title">Добавить материалы</h2>
          <p className="muted">Ничего не попадёт в Канон без вашего решения.</p>
        </div>
        <button type="button" className="materials-close" aria-label="Закрыть" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="materials-body">
        <div className="materials-modes" role="radiogroup" aria-labelledby="materials-mode-title">
          <span id="materials-mode-title" className="cap">Как добавить</span>
          <label className={`mode-card ${mode === "import" ? "mode-card-on" : ""}`}>
            <input
              type="radio"
              name="materials-mode"
              checked={mode === "import"}
              onChange={() => setMode("import")}
            />
            <span className="mode-card-title">Готовые главы, без модели</span>
            <span className="mode-card-text">
              Каждый файл .md или .txt сразу становится главой. Бесплатно.
            </span>
          </label>
          <label className={`mode-card ${mode === "intake" ? "mode-card-on" : ""}`}>
            <input
              type="radio"
              name="materials-mode"
              checked={mode === "intake"}
              onChange={() => setMode("intake")}
            />
            <span className="mode-card-title">Разобрать моделью</span>
            <span className="mode-card-text">
              Модель прочтёт черновики и заметки и разложит их на замысел,
              персонажей, план и главы. Главы придут черновиками на проверку.
            </span>
            <span className="mode-card-cost mono">платно</span>
          </label>
        </div>
        <div className="materials-work">
          {/* Оба режима смонтированы всегда: переключение не должно
              обрывать идущий разбор. */}
          <div hidden={mode !== "intake"}>
            <IntakePanel bookId={bookId} onIntake={onChanged} />
          </div>
          <div hidden={mode !== "import"}>
            <ImportChaptersPanel bookId={bookId} onImported={onChanged} />
          </div>
        </div>
      </div>
      <div className="materials-foot">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Свернуть
        </button>
      </div>
    </dialog>
  );
}
