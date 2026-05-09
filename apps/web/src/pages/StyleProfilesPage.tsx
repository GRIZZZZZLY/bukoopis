import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import type {
  ReferenceCorpus,
  StyleProfile,
} from "@book-forge/shared";

export function StyleProfilesListPage() {
  const [list, setList] = useState<StyleProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("ru");
  const [creating, setCreating] = useState(false);

  async function load() {
    setError(null);
    try {
      setList(await api.listStyleProfiles());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await api.createStyleProfile({
        name: name.trim(),
        language: language || "ru",
      });
      setName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  if (error) return <p className="p-8">Ошибка: {error}</p>;
  if (list === null) return <p className="p-8">Загрузка…</p>;

  return (
    <main className="max-w-3xl mx-auto p-8 flex flex-col gap-6">
      <Link to="/books" className="text-sm underline">
        ← К списку книг
      </Link>
      <h1 className="text-3xl font-bold">Стилевые профили</h1>

      <form onSubmit={onCreate} className="flex gap-2 flex-wrap">
        <input
          className="flex-1 border border-[var(--color-input)] rounded-md px-3 py-2 text-sm min-w-[200px]"
          placeholder="Имя профиля (например: Пехов)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="w-20 border border-[var(--color-input)] rounded-md px-2 py-2 text-sm"
          placeholder="ru"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        />
        <Button type="submit" disabled={creating || !name.trim()}>
          + Создать
        </Button>
      </form>

      {list.length === 0 ? (
        <p className="text-[var(--color-muted-foreground)]">
          Нет профилей. Создай первый.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((p) => (
            <li
              key={p.id}
              className="border border-[var(--color-border)] rounded-md p-4 hover:bg-[var(--color-accent)]"
            >
              <Link to={`/style-profiles/${p.id}`} className="block">
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-[var(--color-muted-foreground)]">
                  {p.language} · корпусов: {p.corporaCount} ·{" "}
                  {p.totalChars.toLocaleString("ru-RU")} символов ·{" "}
                  {p.fingerprint
                    ? "fingerprint готов"
                    : "fingerprint не извлечён"}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export function StyleProfilePage() {
  const { profileId } = useParams<{ profileId: string }>();
  const id = Number(profileId);
  const navigate = useNavigate();

  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const [corpora, setCorpora] = useState<ReferenceCorpus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [p, c] = await Promise.all([
        api.getStyleProfile(id),
        api.listCorpora(id),
      ]);
      setProfile(p);
      setCorpora(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      let content: string;
      let encoding: "utf8" | "base64";
      if (ext === "epub") {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i++)
          binary += String.fromCharCode(bytes[i]!);
        content = btoa(binary);
        encoding = "base64";
      } else {
        content = await file.text();
        encoding = "utf8";
      }
      await api.uploadCorpus(id, {
        filename: file.name,
        content,
        encoding,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function onExtract() {
    setExtracting(true);
    setExtractError(null);
    try {
      await api.runStyleExtract(id, { sampleSize: 30 });
      await load();
    } catch (e) {
      setExtractError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(false);
    }
  }

  async function onDeleteProfile() {
    if (!confirm("Удалить профиль со всеми корпусами и сценами?")) return;
    try {
      await api.deleteStyleProfile(id);
      navigate("/style-profiles");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (error) return <p className="p-8">Ошибка: {error}</p>;
  if (!profile || corpora === null) return <p className="p-8">Загрузка…</p>;

  return (
    <main className="max-w-3xl mx-auto p-8 flex flex-col gap-6">
      <Link to="/style-profiles" className="text-sm underline">
        ← К списку профилей
      </Link>
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">{profile.name}</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {profile.language} · {profile.description ?? "(без описания)"}
          </p>
        </div>
        <Button variant="destructive" onClick={onDeleteProfile}>
          Удалить профиль
        </Button>
      </div>

      <section className="flex flex-col gap-3 border border-[var(--color-border)] rounded-md p-4">
        <h2 className="text-xl font-semibold">Корпус (.txt / .md / .fb2 / .epub)</h2>
        <div className="text-sm text-[var(--color-muted-foreground)]">
          Всего корпусов: {profile.corporaCount} ·{" "}
          {profile.totalChars.toLocaleString("ru-RU")} символов
        </div>
        <input
          type="file"
          accept=".txt,.md,.markdown,.fb2,.epub"
          onChange={onFile}
          disabled={uploading}
        />
        {uploading && <p className="text-sm">Загрузка…</p>}
        {corpora.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Корпус пуст.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {corpora.map((c) => (
              <li
                key={c.id}
                className="text-sm flex justify-between items-center border border-[var(--color-border)] rounded-md p-2"
              >
                <span>
                  <strong>{c.filename}</strong> · {c.format} ·{" "}
                  {c.charCount.toLocaleString("ru-RU")} симв · {c.sceneCount} сцен
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={async () => {
                    await api.deleteCorpus(id, c.id);
                    await load();
                  }}
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 border border-[var(--color-border)] rounded-md p-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold">Style Extractor</h2>
          <Button onClick={onExtract} disabled={extracting || corpora.length === 0}>
            {extracting ? "Анализ…" : "Извлечь fingerprint"}
          </Button>
        </div>
        {extractError && (
          <p className="text-sm text-red-600">Ошибка: {extractError}</p>
        )}
        {profile.lastExtractedAt && (
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Последний прогон:{" "}
            {new Date(profile.lastExtractedAt).toLocaleString("ru-RU")}
          </p>
        )}
        {profile.fingerprint ? (
          <div className="text-sm flex flex-col gap-2">
            <div>
              <strong>Voice:</strong> {profile.fingerprint.voiceSummary}
            </div>
            <div>
              <strong>Время:</strong> {profile.fingerprint.tense}
            </div>
            <div>
              <strong>Ритм абзаца:</strong> {profile.fingerprint.paragraphRhythm}
            </div>
            <details>
              <summary className="cursor-pointer text-xs underline">
                Полный fingerprint (JSON)
              </summary>
              <pre className="text-xs mt-2 bg-[var(--color-muted)] p-2 rounded-md overflow-auto max-h-[400px]">
                {JSON.stringify(profile.fingerprint, null, 2)}
              </pre>
            </details>
            {profile.fatigueWords && (
              <details>
                <summary className="cursor-pointer text-xs underline">
                  Fatigue-words (
                  {profile.fatigueWords.blacklist.length} +{" "}
                  {profile.fatigueWords.softWarn.length})
                </summary>
                <div className="text-xs mt-2">
                  <strong>Blacklist:</strong>{" "}
                  {profile.fatigueWords.blacklist.join(", ") || "—"}
                </div>
                <div className="text-xs mt-1">
                  <strong>Soft-warn:</strong>{" "}
                  {profile.fatigueWords.softWarn.join(", ") || "—"}
                </div>
              </details>
            )}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Fingerprint ещё не извлечён. Загрузи корпус и нажми «Извлечь fingerprint».
          </p>
        )}
      </section>
    </main>
  );
}
