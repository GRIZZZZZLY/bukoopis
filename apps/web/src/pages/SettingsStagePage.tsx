import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ConfirmDialog } from "@/components/ui/AlertDialog";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { StageStepper } from "@/components/studio/StageStepper";
import { api } from "@/api/client";
import { toast } from "@/lib/toast";
import { estimatePerChapterUsd } from "@/lib/chapter-cost";
import type {
  Book,
  BookConcept,
  BookStatus,
  ModelChoice,
  StudioState,
  StyleProfile,
  WriterProvider,
} from "@book-forge/shared";

const STATUSES: BookStatus[] = ["draft", "active", "archived"];
const MODELS: ModelChoice[] = ["sonnet", "opus"];
const PROVIDERS: WriterProvider[] = ["anthropic", "ollama"];

const STATUS_RU: Record<BookStatus, string> = {
  draft: "черновик",
  active: "активна",
  archived: "архив",
};

export function SettingsStagePage() {
  const { bookId } = useParams<{ bookId: string }>();
  const id = Number(bookId);
  const navigate = useNavigate();

  const [book, setBook] = useState<Book | null>(null);
  const [styleProfiles, setStyleProfiles] = useState<StyleProfile[]>([]);
  const [concept, setConcept] = useState<BookConcept | null>(null);
  const [studio, setStudio] = useState<StudioState | null>(null);
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
      const [b, sp, c, s] = await Promise.all([
        api.getBook(id),
        api.listStyleProfiles(),
        api.getConcept(id),
        api.getStudioState(id),
      ]);
      setBook(b);
      setStyleProfiles(sp);
      setConcept(c);
      setStudio(s);
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
        <div style={{ maxWidth: 760, margin: "0 auto", padding: 32 }}>
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
        <div style={{ maxWidth: 760, margin: "0 auto", padding: 32 }}>
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
  if (!book || !concept || !studio) {
    return <PageSkeleton label="Настройки книги загружаются" />;
  }

  return (
    <div className="route" data-screen-label="Book settings">
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto",
          padding: "32px 32px 96px",
        }}
      >
        {/* Hero */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 24,
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div className="caption" style={{ marginBottom: 6 }}>
              Книга · #{id}
            </div>
            <h1
              className="font-display"
              style={{
                fontSize: 32,
                fontWeight: 500,
                margin: 0,
                color: "var(--color-text-strong)",
                letterSpacing: "-0.015em",
              }}
            >
              Настройки
            </h1>
            <div className="text-muted" style={{ fontSize: 13, marginTop: 6 }}>
              Метаданные книги, модели агентов, провайдер.
            </div>
          </div>
          <Link
            to={`/books/${id}/studio`}
            className="btn btn-ghost btn-sm"
            style={{ textDecoration: "none" }}
          >
            ← к Studio
          </Link>
        </div>

        {/* Stepper */}
        <div style={{ marginBottom: 28, overflowX: "auto", paddingBottom: 4 }}>
          <StageStepper
            bookId={id}
            concept={concept}
            studioState={studio}
          />
        </div>

        {/* Identity panel */}
        <div
          className="panel"
          style={{
            padding: 24,
            marginBottom: 16,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <input
            className="font-display"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Название книги"
            style={{
              fontSize: 28,
              fontWeight: 500,
              lineHeight: 1.2,
              color: "var(--color-text-strong)",
              background: "transparent",
              border: 0,
              borderBottom: "1px solid var(--color-border)",
              padding: "4px 0",
              outline: "none",
              transition: "border-color 160ms",
            }}
            onFocus={(e) =>
              (e.currentTarget.style.borderBottomColor = "var(--color-brass)")
            }
            onBlur={(e) =>
              (e.currentTarget.style.borderBottomColor = "var(--color-border)")
            }
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
            }}
          >
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                fontSize: 13,
              }}
            >
              <span className="caption">Статус</span>
              <select
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
            </label>
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                fontSize: 13,
              }}
            >
              <span className="caption">Стилевой профиль</span>
              <select
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
            </label>
          </div>
        </div>

        {/* Models panel */}
        <div
          className="panel"
          style={{
            padding: 24,
            marginBottom: 16,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <h2 className="caption" style={{ margin: 0 }}>
            Модели агентов
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 12,
            }}
          >
            {(
              [
                ["Writer", writerModel, setWriterModel] as const,
                ["Plot", plotModel, setPlotModel] as const,
                ["Critic", criticModel, setCriticModel] as const,
              ]
            ).map(([label, value, setter]) => (
              <label
                key={label}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  fontSize: 13,
                }}
              >
                <span
                  className="font-mono"
                  style={{
                    fontSize: 11,
                    color: "var(--color-text-muted)",
                    letterSpacing: "0.04em",
                  }}
                >
                  {label}
                </span>
                <select
                  className="select"
                  value={value}
                  onChange={(e) => setter(e.target.value as ModelChoice)}
                >
                  {MODELS.map((mm) => (
                    <option key={mm} value={mm}>
                      {mm}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p
            className="text-muted"
            style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}
          >
            Прогноз ~
            <span
              className="font-mono"
              style={{ color: "var(--color-text-strong)" }}
            >
              $
              {writerProvider === "ollama"
                ? estimatePerChapterUsd(
                    "sonnet",
                    plotModel,
                    criticModel,
                  ).toFixed(2)
                : estimatePerChapterUsd(
                    writerModel,
                    plotModel,
                    criticModel,
                  ).toFixed(2)}
            </span>{" "}
            / глава (4k слов; без учёта prompt-кэша
            {writerProvider === "ollama"
              ? "; Writer бесплатный — локальная модель"
              : ""}
            ).
          </p>
        </div>

        {/* Provider panel */}
        <fieldset
          className="panel"
          style={{
            padding: 24,
            marginBottom: 24,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            border: "1px solid var(--color-border-soft)",
          }}
          aria-label="Провайдер для Writer"
        >
          <legend
            className="caption"
            style={{ padding: "0 6px", marginLeft: -6 }}
          >
            Provider для Writer
          </legend>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 16,
              fontSize: 13,
            }}
          >
            {PROVIDERS.map((p) => (
              <label
                key={p}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="writer-provider"
                  value={p}
                  checked={writerProvider === p}
                  onChange={() => setWriterProvider(p)}
                  style={{ accentColor: "var(--color-brass)" }}
                />
                <span>
                  {p === "anthropic" ? "Cloud (Anthropic)" : "Local (Ollama)"}
                </span>
              </label>
            ))}
          </div>
          {writerProvider === "ollama" && (
            <div
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              <label
                className="caption"
                htmlFor="writer-local-model"
                style={{ textTransform: "none", letterSpacing: 0 }}
              >
                Тег локальной модели
              </label>
              <input
                id="writer-local-model"
                className="input"
                value={writerLocalModel}
                onChange={(e) => setWriterLocalModel(e.target.value)}
                placeholder="например, qwen2.5:14b-instruct"
              />
              <p className="text-muted" style={{ fontSize: 12 }}>
                Сервер должен достигать Ollama по{" "}
                <code className="font-mono">OLLAMA_BASE_URL</code> (по умолчанию{" "}
                <code className="font-mono">http://127.0.0.1:11434</code>). Plot
                и Critic остаются на cloud-моделях.
              </p>
            </div>
          )}
        </fieldset>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
          <button
            type="button"
            className="btn btn-destructive"
            onClick={() => setDeleteDialogOpen(true)}
            aria-label={`Удалить книгу «${book.title}»`}
          >
            Удалить книгу
          </button>
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
