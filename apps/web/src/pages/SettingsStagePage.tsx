import { useEffect, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { ConfirmDialog } from "@/components/ui/AlertDialog";
import { PageSkeleton } from "@/components/ui/Skeleton";
import type { BookRoomContext } from "@/components/book/BookLayout";
import { api } from "@/api/client";
import { toast } from "@/lib/toast";
import { formatUsdApprox } from "@/lib/money";
import { estimatePerChapterUsd } from "@/lib/chapter-cost";
import type {
  Book,
  BookStatus,
  ModelChoice,
  StyleProfile,
  WriterProvider,
} from "@book-forge/shared";

const STATUSES: BookStatus[] = ["draft", "active", "archived"];
const MODELS: ModelChoice[] = ["sonnet", "opus"];

const STATUS_RU: Record<BookStatus, string> = {
  draft: "черновик",
  active: "активна",
  archived: "архив",
};

export function SettingsStagePage() {
  const { bookId } = useParams<{ bookId: string }>();
  const id = Number(bookId);
  const navigate = useNavigate();
  // Вне дома книги (в тестах) контекста нет — шапку перечитывать некому.
  const room = useOutletContext<BookRoomContext | undefined>();

  const [book, setBook] = useState<Book | null>(null);
  const [styleProfiles, setStyleProfiles] = useState<StyleProfile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<BookStatus>("draft");
  const [styleProfileId, setStyleProfileId] = useState<number | null>(null);
  const [writerModel, setWriterModel] = useState<ModelChoice>("opus");
  const [plotModel, setPlotModel] = useState<ModelChoice>("sonnet");
  const [criticModel, setCriticModel] = useState<ModelChoice>("sonnet");
  const [writerProvider, setWriterProvider] =
    useState<WriterProvider>("anthropic");
  const [writerLocalModel, setWriterLocalModel] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setError(null);
    try {
      const [b, sp] = await Promise.all([api.getBook(id), api.listStyleProfiles()]);
      setBook(b);
      setStyleProfiles(sp);
      setTitle(b.title);
      setStatus(b.status);
      setStyleProfileId(b.styleProfileId);
      setWriterModel(b.writerModel);
      setPlotModel(b.plotModel);
      setCriticModel(b.criticModel);
      setWriterProvider(b.writerProvider);
      setWriterLocalModel(b.writerLocalModel ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      await api.updateBook(id, {
        title: title.trim() || book!.title,
        status,
        styleProfileId,
        writerModel,
        plotModel,
        criticModel,
        writerProvider,
        writerLocalModel:
          writerProvider === "ollama" && writerLocalModel.trim()
            ? writerLocalModel.trim()
            : null,
      });
      await load();
      room?.reloadBook();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onConfirmDelete() {
    setDeleting(true);
    try {
      await api.deleteBook(id);
      toast.success("Книга удалена");
      navigate("/books");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error("Не удалось удалить", { description: msg });
      setDeleting(false);
    }
  }

  if (!Number.isFinite(id)) {
    return (
      <div className="route">
        <div className="page">
          <p
            role="alert"
            className="card"
            style={{
              borderLeft: "3px solid var(--color-ink-red)",
              color: "var(--color-ink-red)",
            }}
          >
            Книга не найдена
          </p>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="route">
        <div className="page">
          <p
            role="alert"
            className="card"
            style={{
              borderLeft: "3px solid var(--color-ink-red)",
              color: "var(--color-ink-red)",
            }}
          >
            Ошибка: {error}
          </p>
        </div>
      </div>
    );
  }
  if (!book) {
    return <PageSkeleton label="Настройки книги загружаются" />;
  }

  const forecastUsd =
    writerProvider === "ollama"
      ? estimatePerChapterUsd("sonnet", plotModel, criticModel)
      : estimatePerChapterUsd(writerModel, plotModel, criticModel);

  return (
    <div className="route" data-screen-label="Book settings">
      <div className="settings-sec">
        <div className="section-bar">
          <div className="section-bar-title">
            <h2>Настройки</h2>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>

        {/* Identity */}
        <div className="card">
          <div className="panel-head" style={{ marginBottom: 14 }}>
            <h3>Идентичность</h3>
          </div>
          <div className="settings-grid">
            <div className="field">
              <label className="field-label" htmlFor="book-title">
                Название
              </label>
              <input
                id="book-title"
                className="input input-lg input-display"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                aria-label="Название книги"
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="book-status">
                Статус
              </label>
              <select
                id="book-status"
                className="select"
                value={status}
                onChange={(e) => setStatus(e.target.value as BookStatus)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_RU[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="book-style">
                Профиль стиля
              </label>
              <select
                id="book-style"
                className="select"
                value={styleProfileId ?? ""}
                onChange={(e) =>
                  setStyleProfileId(
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              >
                <option value="">— без стиля —</option>
                {styleProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {!p.fingerprint ? " (нет fingerprint)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Models */}
        <div className="card">
          <div className="panel-head" style={{ marginBottom: 14 }}>
            <h3>Модели</h3>
            <span className="cap mono faint">
              {formatUsdApprox(forecastUsd)} за главу
            </span>
          </div>
          <div className="settings-grid">
            {(
              [
                ["Писатель", writerModel, setWriterModel] as const,
                ["План", plotModel, setPlotModel] as const,
                ["Критик", criticModel, setCriticModel] as const,
              ]
            ).map(([label, value, setter]) => (
              <div key={label} className="field">
                <label className="field-label">{label}</label>
                <select
                  className="select"
                  value={value}
                  onChange={(e) => setter(e.target.value as ModelChoice)}
                  aria-label={label}
                >
                  {MODELS.map((mm) => (
                    <option key={mm} value={mm}>
                      {mm}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <p className="muted tabular" style={{ fontSize: 12, marginTop: 12 }}>
            Прогноз на главу 4k слов, без учёта prompt-кэша
            {writerProvider === "ollama"
              ? "; Писатель бесплатный — локальная модель"
              : ""}
            .
          </p>
        </div>

        {/* Provider */}
        <div className="card">
          <div className="panel-head" style={{ marginBottom: 14 }}>
            <h3>Провайдер</h3>
          </div>
          <div className="provider">
            <label
              className={`provider-card ${writerProvider === "anthropic" ? "provider-card-active" : ""}`}
            >
              <input
                type="radio"
                name="writer-provider"
                value="anthropic"
                checked={writerProvider === "anthropic"}
                onChange={() => setWriterProvider("anthropic")}
                style={{ accentColor: "var(--color-brass)" }}
              />
              <div>
                <div className="strong">Anthropic</div>
                <div className="muted cap">
                  Облако: письмо, план и критика.
                </div>
              </div>
            </label>
            <label
              className={`provider-card ${writerProvider === "ollama" ? "provider-card-active" : ""}`}
            >
              <input
                type="radio"
                name="writer-provider"
                value="ollama"
                checked={writerProvider === "ollama"}
                onChange={() => setWriterProvider("ollama")}
                style={{ accentColor: "var(--color-brass)" }}
              />
              <div>
                <div className="strong">Ollama (локально)</div>
                <div className="muted cap">
                  Письмо — локально, план и критика — в облаке.
                </div>
              </div>
            </label>
          </div>
          {writerProvider === "ollama" && (
            <div className="field" style={{ marginTop: 14 }}>
              <label className="field-label" htmlFor="writer-local-model">
                Тег локальной модели
              </label>
              <input
                id="writer-local-model"
                className="input"
                value={writerLocalModel}
                onChange={(e) => setWriterLocalModel(e.target.value)}
                placeholder="например, qwen2.5:14b-instruct"
              />
              <p className="field-hint">
                Сервер должен достигать Ollama по OLLAMA_BASE_URL (по умолчанию
                http://127.0.0.1:11434). План и критика остаются на
                cloud-моделях.
              </p>
            </div>
          )}
        </div>

        {/* Danger zone */}
        <div className="card panel-danger">
          <div className="panel-head" style={{ marginBottom: 14 }}>
            <h3 style={{ color: "var(--color-ink-red)" }}>Опасная зона</h3>
          </div>
          <div className="danger-row">
            <div>
              <div className="strong">Удалить книгу</div>
              <div className="muted cap">
                Удаляются главы, профиль, разборы и канон. Восстановление
                невозможно.
              </div>
            </div>
            <button
              type="button"
              className="btn btn-destructive"
              onClick={() => setDeleteDialogOpen(true)}
              aria-label={`Удалить книгу «${book.title}»`}
            >
              Удалить книгу
            </button>
          </div>
        </div>

        <ConfirmDialog
          open={deleteDialogOpen}
          title={`Удалить «${book.title}»?`}
          description={
            <>
              Будут безвозвратно удалены: книга, её главы, план, канон и
              история стиля. Действие необратимо.
            </>
          }
          confirmText="Удалить навсегда"
          cancelText="Не удалять"
          variant="destructive"
          busy={deleting}
          onConfirm={() => void onConfirmDelete()}
          onCancel={() => setDeleteDialogOpen(false)}
        />
      </div>
    </div>
  );
}
