import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { api } from "@/api/client";
import type { ReferenceCorpus, StyleProfile } from "@book-forge/shared";

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

  if (error)
    return (
      <div className="route">
        <div style={{ maxWidth: 960, margin: "0 auto", padding: 32 }}>
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
  if (list === null)
    return (
      <div className="route">
        <div
          style={{
            maxWidth: 960,
            margin: "0 auto",
            padding: 32,
            color: "var(--color-text-muted)",
            fontSize: 13,
          }}
        >
          Загрузка…
        </div>
      </div>
    );

  return (
    <div className="route" data-screen-label="Style profiles">
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "32px 32px 96px",
        }}
      >
        {/* Hero */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginBottom: 32,
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div className="caption" style={{ marginBottom: 6 }}>
              Стиль
            </div>
            <h1
              className="font-display"
              style={{
                fontSize: 36,
                fontWeight: 500,
                margin: 0,
                color: "var(--color-text-strong)",
                letterSpacing: "-0.015em",
              }}
            >
              Стилевые профили
            </h1>
            <div
              className="text-muted"
              style={{ fontSize: 14, marginTop: 8 }}
            >
              {list.length === 0
                ? "Профилей пока нет — извлеките голос из готовой книги."
                : `${list.length} ${list.length === 1 ? "профиль" : "профилей"}`}
            </div>
          </div>
        </div>

        {/* Create form */}
        <form
          onSubmit={onCreate}
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 24,
          }}
        >
          <input
            className="input"
            placeholder="Имя профиля (например: Пехов)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ flex: 1, minWidth: 220 }}
          />
          <input
            className="input"
            placeholder="ru"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            style={{ width: 80 }}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={creating || !name.trim()}
          >
            <Plus size={14} aria-hidden="true" />
            Создать
          </button>
        </form>

        {/* List */}
        {list.length === 0 ? (
          <div
            className="card"
            style={{
              padding: 40,
              textAlign: "center",
              borderStyle: "dashed",
              color: "var(--color-text-muted)",
              fontSize: 13,
              fontStyle: "italic",
            }}
          >
            Нет профилей. Создайте первый — извлечём голос из загруженного
            корпуса.
          </div>
        ) : (
          <ul
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 16,
              listStyle: "none",
              margin: 0,
              padding: 0,
            }}
          >
            {list.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/style-profiles/${p.id}`}
                  className="card hoverable"
                  style={{
                    display: "block",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <div
                    className="font-display"
                    style={{
                      fontSize: 20,
                      fontWeight: 500,
                      lineHeight: 1.2,
                      color: "var(--color-text-strong)",
                    }}
                  >
                    {p.name}
                  </div>
                  <div
                    className="font-mono"
                    style={{
                      fontSize: 11,
                      color: "var(--color-text-faint)",
                      marginTop: 6,
                    }}
                  >
                    {p.language} · корпусов: {p.corporaCount} ·{" "}
                    {p.totalChars.toLocaleString("ru-RU")} символов
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <span
                      className={`pill pill-${p.fingerprint ? "green" : "amber"}`}
                    >
                      <span
                        className="dot"
                        style={{ background: "currentColor" }}
                      />
                      {p.fingerprint
                        ? "fingerprint готов"
                        : "fingerprint не извлечён"}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
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
      await api.uploadCorpus(id, { filename: file.name, content, encoding });
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

  if (error)
    return (
      <div className="route">
        <div style={{ maxWidth: 880, margin: "0 auto", padding: 32 }}>
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
  if (!profile || corpora === null)
    return (
      <div className="route">
        <div
          style={{
            maxWidth: 880,
            margin: "0 auto",
            padding: 32,
            color: "var(--color-text-muted)",
            fontSize: 13,
          }}
        >
          Загрузка…
        </div>
      </div>
    );

  return (
    <div className="route" data-screen-label="Style profile">
      <div
        style={{
          maxWidth: 880,
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
              Стилевой профиль · #{id}
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
              {profile.name}
            </h1>
            <div
              className="text-muted"
              style={{ fontSize: 13, marginTop: 6 }}
            >
              <span className="font-mono">{profile.language}</span> ·{" "}
              {profile.description ?? "(без описания)"}
            </div>
          </div>
          <div
            style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
          >
            <Link
              to="/style-profiles"
              className="btn btn-ghost btn-sm"
              style={{ textDecoration: "none" }}
            >
              ← К списку
            </Link>
            <button
              type="button"
              className="btn btn-destructive btn-sm"
              onClick={onDeleteProfile}
            >
              Удалить
            </button>
          </div>
        </div>

        {/* Corpus panel */}
        <div
          className="panel"
          style={{
            padding: 24,
            marginBottom: 16,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <h2
              className="font-display"
              style={{
                fontSize: 20,
                fontWeight: 500,
                margin: 0,
                color: "var(--color-text-strong)",
              }}
            >
              Корпус
            </h2>
            <div
              className="font-mono"
              style={{
                fontSize: 11,
                color: "var(--color-text-faint)",
              }}
            >
              {profile.corporaCount} файлов ·{" "}
              {profile.totalChars.toLocaleString("ru-RU")} символов
            </div>
          </div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            Поддерживаются:{" "}
            <span className="font-mono">.txt</span>,{" "}
            <span className="font-mono">.md</span>,{" "}
            <span className="font-mono">.fb2</span>,{" "}
            <span className="font-mono">.epub</span>
          </div>
          <input
            type="file"
            accept=".txt,.md,.markdown,.fb2,.epub"
            onChange={onFile}
            disabled={uploading}
            style={{ fontSize: 13 }}
          />
          {uploading && (
            <p
              className="text-muted"
              style={{ fontSize: 13, fontStyle: "italic" }}
            >
              Загрузка…
            </p>
          )}
          {corpora.length === 0 ? (
            <p
              className="text-muted"
              style={{ fontSize: 13, fontStyle: "italic" }}
            >
              Корпус пуст.
            </p>
          ) : (
            <ul
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                listStyle: "none",
                margin: 0,
                padding: 0,
              }}
            >
              {corpora.map((c) => (
                <li
                  key={c.id}
                  className="card"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                  }}
                >
                  <span style={{ fontSize: 13, minWidth: 0 }}>
                    <strong style={{ color: "var(--color-text-strong)" }}>
                      {c.filename}
                    </strong>
                    <span
                      className="font-mono"
                      style={{
                        fontSize: 11,
                        color: "var(--color-text-faint)",
                        marginLeft: 8,
                      }}
                    >
                      {c.format} · {c.charCount.toLocaleString("ru-RU")} симв ·{" "}
                      {c.sceneCount} сцен
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-destructive btn-sm"
                    onClick={async () => {
                      await api.deleteCorpus(id, c.id);
                      await load();
                    }}
                    aria-label={`Удалить ${c.filename}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Extractor panel */}
        <div
          className="panel"
          style={{
            padding: 24,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <h2
              className="font-display"
              style={{
                fontSize: 20,
                fontWeight: 500,
                margin: 0,
                color: "var(--color-text-strong)",
              }}
            >
              Style Extractor
            </h2>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onExtract}
              disabled={extracting || corpora.length === 0}
            >
              {extracting ? "Анализ…" : "Извлечь fingerprint"}
            </button>
          </div>
          {extractError && (
            <p
              role="alert"
              className="card"
              style={{
                borderLeft: "3px solid var(--color-ink-red)",
                color: "var(--color-ink-red)",
                fontSize: 13,
                padding: "10px 14px",
              }}
            >
              Ошибка: {extractError}
            </p>
          )}
          {profile.lastExtractedAt && (
            <p
              className="font-mono"
              style={{ fontSize: 11, color: "var(--color-text-faint)" }}
            >
              Последний прогон:{" "}
              {new Date(profile.lastExtractedAt).toLocaleString("ru-RU")}
            </p>
          )}
          {profile.fingerprint ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                fontSize: 13,
              }}
            >
              <FingerprintRow label="Voice" value={profile.fingerprint.voiceSummary} />
              <FingerprintRow label="Время" value={profile.fingerprint.tense} />
              <FingerprintRow
                label="Ритм абзаца"
                value={profile.fingerprint.paragraphRhythm}
              />
              <details>
                <summary
                  style={{
                    cursor: "pointer",
                    fontSize: 12,
                    color: "var(--color-text-muted)",
                  }}
                >
                  Полный fingerprint (JSON)
                </summary>
                <pre
                  className="font-mono"
                  style={{
                    fontSize: 11,
                    marginTop: 8,
                    padding: 12,
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border-soft)",
                    borderRadius: 8,
                    overflow: "auto",
                    maxHeight: 400,
                  }}
                >
                  {JSON.stringify(profile.fingerprint, null, 2)}
                </pre>
              </details>
              {profile.fatigueWords && (
                <details>
                  <summary
                    style={{
                      cursor: "pointer",
                      fontSize: 12,
                      color: "var(--color-text-muted)",
                    }}
                  >
                    Fatigue-words (
                    {profile.fatigueWords.blacklist.length} +{" "}
                    {profile.fatigueWords.softWarn.length})
                  </summary>
                  <div style={{ fontSize: 12, marginTop: 8 }}>
                    <strong>Blacklist:</strong>{" "}
                    {profile.fatigueWords.blacklist.join(", ") || "—"}
                  </div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    <strong>Soft-warn:</strong>{" "}
                    {profile.fatigueWords.softWarn.join(", ") || "—"}
                  </div>
                </details>
              )}
            </div>
          ) : (
            <p
              className="text-muted"
              style={{ fontSize: 13, fontStyle: "italic" }}
            >
              Fingerprint ещё не извлечён. Загрузи корпус и нажми «Извлечь
              fingerprint».
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function FingerprintRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="caption">{label}</span>
      <div
        style={{
          marginTop: 4,
          color: "var(--color-text-strong)",
          fontSize: 13,
        }}
      >
        {value}
      </div>
    </div>
  );
}
