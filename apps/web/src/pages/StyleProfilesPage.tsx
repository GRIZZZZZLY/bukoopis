import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Plus, Blend } from "lucide-react";
import { api } from "@/api/client";
import { StyleBlendForm } from "@/components/style/StyleBlendForm";
import type { ReferenceCorpus, StyleProfile } from "@book-forge/shared";

function profileWord(n: number): string {
  const r = n % 10;
  const rr = n % 100;
  if (rr >= 11 && rr <= 14) return "профилей";
  if (r === 1) return "профиль";
  if (r >= 2 && r <= 4) return "профиля";
  return "профилей";
}

function sourceWord(n: number): string {
  const r = n % 10;
  const rr = n % 100;
  if (rr >= 11 && rr <= 14) return "источников";
  if (r === 1) return "источника";
  if (r >= 2 && r <= 4) return "источников";
  return "источников";
}

export function StyleProfilesListPage() {
  const [list, setList] = useState<StyleProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("ru");
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showBlend, setShowBlend] = useState(false);

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
      setShowForm(false);
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
  if (list === null)
    return (
      <div className="route">
        <div className="page muted" style={{ fontSize: 13 }}>
          Загрузка…
        </div>
      </div>
    );

  return (
    <div className="route" data-screen-label="Style profiles">
      <div className="page page-styles">
        <div className="page-head">
          <div>
            <h1>Профили стиля</h1>
            <p className="muted page-sub">
              Голос, к которому возвращается писатель. Извлекаются из готового
              текста или собираются вручную.
              {list.length > 0 && (
                <>
                  {" "}
                  Сейчас: {list.length} {profileWord(list.length)}.
                </>
              )}
            </p>
          </div>
          {!showForm ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowBlend((v) => !v)}
              >
                <Blend size={16} aria-hidden="true" />
                Смешать стили
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowForm(true)}
              >
                <Plus size={16} aria-hidden="true" />
                Новый профиль
              </button>
            </div>
          ) : (
            <form
              onSubmit={onCreate}
              style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
              aria-label="Создать профиль стиля"
            >
              <input
                className="input"
                autoFocus
                placeholder="Имя профиля (например: Пехов)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ width: 220 }}
              />
              <input
                className="input"
                placeholder="ru"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                style={{ width: 64 }}
                aria-label="Язык"
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={creating || !name.trim()}
              >
                {creating ? "…" : "Создать"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowForm(false)}
              >
                Отмена
              </button>
            </form>
          )}
        </div>

        {showBlend && (
          <StyleBlendForm
            profiles={list}
            onCreated={() => {
              setShowBlend(false);
              load();
            }}
            onCancel={() => setShowBlend(false)}
          />
        )}

        {list.length === 0 ? (
          <div
            className="card muted"
            style={{
              padding: 40,
              textAlign: "center",
              borderStyle: "dashed",
              fontSize: 13,
              fontStyle: "italic",
            }}
          >
            Нет профилей. Создайте первый — извлечём голос из загруженного
            корпуса.
          </div>
        ) : (
          <div className="style-grid">
            {list.map((p) => (
              <Link
                key={p.id}
                to={`/style-profiles/${p.id}`}
                className="style-card"
              >
                <h2>{p.name}</h2>
                <div className="cap muted">
                  {p.kind === "blend" ? (
                    <>
                      {p.language} · смесь из{" "}
                      {p.blendConfig?.sources.length ?? 0}{" "}
                      {sourceWord(p.blendConfig?.sources.length ?? 0)}
                    </>
                  ) : (
                    <>
                      {p.language} · корпусов: {p.corporaCount} ·{" "}
                      {p.totalChars.toLocaleString("ru-RU")} симв.
                    </>
                  )}
                </div>
                <div className="style-foot">
                  <span className={`pill pill-${p.fingerprint ? "green" : "amber"}`}>
                    <span className="dot" />
                    {p.fingerprint
                      ? "стиль снят"
                      : "стиль ещё не снят"}
                  </span>
                  {p.kind === "blend" && (
                    <span className="pill">
                      <Blend size={12} aria-hidden="true" />
                      смесь
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
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
  if (!profile || corpora === null)
    return (
      <div className="route">
        <div className="page muted" style={{ fontSize: 13 }}>
          Загрузка…
        </div>
      </div>
    );

  return (
    <div className="route" data-screen-label="Style profile">
      <div className="page page-style">
        <div className="page-head">
          <Link to="/style-profiles" className="back-link mono">
            ← Профили стиля
          </Link>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn btn-destructive btn-sm"
              onClick={onDeleteProfile}
            >
              Удалить
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onExtract}
              disabled={extracting || corpora.length === 0}
            >
              {extracting ? "Анализ…" : "Снять стиль"}
            </button>
          </div>
        </div>

        <div className="style-detail">
          {/* Main column — profile + fingerprint */}
          <section className="style-edit">
            <div className="card">
              <div
                style={{ display: "flex", flexDirection: "column", gap: 14 }}
              >
                <div className="field">
                  <span className="field-label">Имя профиля</span>
                  <div className="input input-lg input-display" aria-readonly>
                    {profile.name}
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">Описание</span>
                  <div className="muted" style={{ fontSize: 13 }}>
                    <span className="mono">{profile.language}</span> ·{" "}
                    {profile.description ?? "(без описания)"}
                  </div>
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
                  <p className="mono faint" style={{ fontSize: 11 }}>
                    Последний прогон:{" "}
                    {new Date(profile.lastExtractedAt).toLocaleString("ru-RU")}
                  </p>
                )}

                {profile.fingerprint ? (
                  <>
                    <div className="field">
                      <span className="field-label">Voice</span>
                      <div className="strong" style={{ fontSize: 13 }}>
                        {profile.fingerprint.voiceSummary}
                      </div>
                    </div>
                    <div className="concept-row">
                      <div className="field">
                        <span className="field-label">Время</span>
                        <div className="strong" style={{ fontSize: 13 }}>
                          {profile.fingerprint.tense}
                        </div>
                      </div>
                      <div className="field">
                        <span className="field-label">Ритм абзаца</span>
                        <div className="strong" style={{ fontSize: 13 }}>
                          {profile.fingerprint.paragraphRhythm}
                        </div>
                      </div>
                    </div>
                    <details>
                      <summary
                        className="muted"
                        style={{ cursor: "pointer", fontSize: 12 }}
                      >
                        Полный fingerprint (JSON)
                      </summary>
                      <pre
                        className="mono"
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
                      <div className="field">
                        <span className="field-label">
                          Избегать ({profile.fatigueWords.blacklist.length} +{" "}
                          {profile.fatigueWords.softWarn.length})
                        </span>
                        <div className="tag-row">
                          {profile.fatigueWords.blacklist.map((w) => (
                            <span key={w} className="tag-chip">
                              {w}
                            </span>
                          ))}
                          {profile.fatigueWords.softWarn.map((w) => (
                            <span
                              key={w}
                              className="tag-chip"
                              style={{ opacity: 0.6 }}
                            >
                              {w}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p
                    className="muted"
                    style={{ fontSize: 13, fontStyle: "italic" }}
                  >
                    Fingerprint ещё не извлечён. Загрузи корпус и нажми
                    «Снять стиль».
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* Aside — corpus sources */}
          <aside className="style-samples">
            <div className="card">
              <div className="panel-head" style={{ marginBottom: 10 }}>
                <h3>Источник</h3>
                <span className="cap mono faint">
                  {profile.corporaCount} файлов ·{" "}
                  {profile.totalChars.toLocaleString("ru-RU")} симв.
                </span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                Поддерживаются: <span className="mono">.txt</span>,{" "}
                <span className="mono">.md</span>,{" "}
                <span className="mono">.fb2</span>,{" "}
                <span className="mono">.epub</span>
              </div>
              <input
                type="file"
                accept=".txt,.md,.markdown,.fb2,.epub"
                onChange={onFile}
                disabled={uploading}
                style={{ fontSize: 13, marginBottom: 10 }}
              />
              {uploading && (
                <p
                  className="muted"
                  style={{ fontSize: 13, fontStyle: "italic" }}
                >
                  Загрузка…
                </p>
              )}
              {corpora.length === 0 ? (
                <p
                  className="muted"
                  style={{ fontSize: 13, fontStyle: "italic" }}
                >
                  Корпус пуст.
                </p>
              ) : (
                <ol className="sample-list">
                  {corpora.map((c) => (
                    <li key={c.id} className="sample-item">
                      <span className="cap mono faint">
                        {c.format} · {c.charCount.toLocaleString("ru-RU")} симв
                        · {c.sceneCount} сцен
                      </span>
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                        }}
                      >
                        <strong className="strong" style={{ fontSize: 13 }}>
                          {c.filename}
                        </strong>
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
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
