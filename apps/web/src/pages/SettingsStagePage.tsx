import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
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
  const [writerProvider, setWriterProvider] = useState<WriterProvider>("anthropic");
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
      <main className="max-w-3xl mx-auto p-8">
        <p role="alert" className="text-sm text-red-600">
          Книга не найдена
        </p>
      </main>
    );
  }
  if (error) {
    return (
      <main className="max-w-3xl mx-auto p-8">
        <p role="alert" className="text-sm text-red-600">
          Ошибка: {error}
        </p>
      </main>
    );
  }
  if (!book || !concept || !studio) {
    return <PageSkeleton label="Настройки книги загружаются" />;
  }

  return (
    <main className="max-w-3xl mx-auto p-8 flex flex-col gap-6">
      <StageStepper bookId={id} concept={concept} studioState={studio} />
      <div className="flex justify-between items-baseline">
        <h1 className="text-3xl font-bold">Настройки</h1>
        <Link to={`/books/${id}/studio`} className="text-sm underline">
          ← к Studio
        </Link>
      </div>

      <section className="flex flex-col gap-3">
        <input
          className="text-2xl font-bold border-b border-[var(--color-border)] py-1 outline-none focus:border-[var(--color-ring)]"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <label className="text-sm font-medium">Статус</label>
        <select
          className="border border-[var(--color-input)] rounded-md px-3 py-2 text-sm w-fit"
          value={status}
          onChange={(e) => setStatus(e.target.value as BookStatus)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <label className="text-sm font-medium">Стилевой профиль</label>
        <select
          className="border border-[var(--color-input)] rounded-md px-3 py-2 text-sm w-fit"
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

        <div className="grid grid-cols-3 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Writer model</span>
            <select
              className="border border-[var(--color-input)] rounded-md px-3 py-2 text-sm"
              value={writerModel}
              onChange={(e) => setWriterModel(e.target.value as ModelChoice)}
            >
              {MODELS.map((mm) => (
                <option key={mm} value={mm}>
                  {mm}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Plot model</span>
            <select
              className="border border-[var(--color-input)] rounded-md px-3 py-2 text-sm"
              value={plotModel}
              onChange={(e) => setPlotModel(e.target.value as ModelChoice)}
            >
              {MODELS.map((mm) => (
                <option key={mm} value={mm}>
                  {mm}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Critic model</span>
            <select
              className="border border-[var(--color-input)] rounded-md px-3 py-2 text-sm"
              value={criticModel}
              onChange={(e) => setCriticModel(e.target.value as ModelChoice)}
            >
              {MODELS.map((mm) => (
                <option key={mm} value={mm}>
                  {mm}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Прогноз ~$
          {writerProvider === "ollama"
            ? estimatePerChapterUsd("sonnet", plotModel, criticModel).toFixed(2)
            : estimatePerChapterUsd(writerModel, plotModel, criticModel).toFixed(
                2,
              )}
          {" "}/ глава при текущих настройках (4k слов; без учёта prompt-кэша
          {writerProvider === "ollama" ? "; Writer бесплатный — локальная модель" : ""}
          ).
        </p>

        <fieldset
          className="border border-[var(--color-border)] rounded-md p-3 flex flex-col gap-2"
          aria-label="Провайдер для Writer"
        >
          <legend className="px-1 text-xs font-medium text-[var(--color-muted-foreground)]">
            Provider для Writer
          </legend>
          <div className="flex flex-wrap gap-3 text-sm">
            {PROVIDERS.map((p) => (
              <label key={p} className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="writer-provider"
                  value={p}
                  checked={writerProvider === p}
                  onChange={() => setWriterProvider(p)}
                />
                <span>
                  {p === "anthropic" ? "Cloud (Anthropic)" : "Local (Ollama)"}
                </span>
              </label>
            ))}
          </div>
          {writerProvider === "ollama" && (
            <div className="flex flex-col gap-1">
              <label
                className="text-xs text-[var(--color-muted-foreground)]"
                htmlFor="writer-local-model"
              >
                Тег локальной модели
              </label>
              <input
                id="writer-local-model"
                className="border border-[var(--color-input)] rounded-md px-3 py-2 text-sm"
                value={writerLocalModel}
                onChange={(e) => setWriterLocalModel(e.target.value)}
                placeholder="например, qwen2.5:14b-instruct"
              />
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Сервер должен достигать Ollama по{" "}
                <code>OLLAMA_BASE_URL</code> (по умолчанию{" "}
                <code>http://127.0.0.1:11434</code>). Plot и Critic остаются на
                cloud-моделях.
              </p>
            </div>
          )}
        </fieldset>

        <div className="flex gap-2">
          <Button onClick={onSave} disabled={saving}>
            {saving ? "Сохранение…" : "Сохранить"}
          </Button>
          <Button
            variant="destructive"
            onClick={() => setDeleteDialogOpen(true)}
            aria-label={`Удалить книгу «${book.title}»`}
          >
            Удалить книгу
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={deleteDialogOpen}
        title={`Удалить «${book.title}»?`}
        description={
          <>
            Будут безвозвратно удалены: книга, её главы, план, канон и история
            стиля. Действие необратимо.
          </>
        }
        confirmText="Удалить навсегда"
        cancelText="Не удалять"
        variant="destructive"
        busy={deleting}
        onConfirm={() => void onConfirmDelete()}
        onCancel={() => setDeleteDialogOpen(false)}
      />
    </main>
  );
}
