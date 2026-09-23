import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { formatUsd } from "@/lib/money";
import type { UsageSummary } from "@book-forge/shared";

function fmt(n: number): string {
  return n.toLocaleString("ru-RU");
}

export function UsagePage() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bookIdFilter, setBookIdFilter] = useState("");
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const params: { bookId?: number; from?: string; to?: string } = {};
      if (bookIdFilter.trim()) params.bookId = Number(bookIdFilter);
      if (fromFilter) params.from = `${fromFilter}T00:00:00.000Z`;
      if (toFilter) params.to = `${toFilter}T23:59:59.999Z`;
      const result = await api.getUsage(params);
      setSummary(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  if (!summary)
    return (
      <div className="route">
        <div className="page muted" style={{ fontSize: 13 }}>
          Загрузка…
        </div>
      </div>
    );

  return (
    <div className="route" data-screen-label="Usage">
      <div className="page page-usage">
        <div className="page-head">
          <div>
            <h1>Расходы</h1>
            <p className="muted page-sub">
              Траты на модель: по маршрутам, по дням, последние 50 вызовов
            </p>
          </div>
        </div>

        {/* Filters */}
        <div
          className="card"
          style={{
            display: "flex",
            gap: 12,
            alignItems: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <label className="field">
            <span className="field-label">Номер книги</span>
            <input
              type="number"
              min={1}
              value={bookIdFilter}
              onChange={(e) => setBookIdFilter(e.target.value)}
              placeholder="все книги"
              className="input"
              style={{ width: 120 }}
            />
          </label>
          <label className="field">
            <span className="field-label">От</span>
            <input
              type="date"
              value={fromFilter}
              onChange={(e) => setFromFilter(e.target.value)}
              className="input"
              style={{ width: 160 }}
            />
          </label>
          <label className="field">
            <span className="field-label">До</span>
            <input
              type="date"
              value={toFilter}
              onChange={(e) => setToFilter(e.target.value)}
              className="input"
              style={{ width: 160 }}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            onClick={load}
            disabled={loading}
          >
            {loading ? "…" : "Применить"}
          </button>
        </div>

        {/* Stats */}
        <div
          className="stat-row"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
        >
          <div className="card stat-card">
            <div className="cap-upper">Всего</div>
            <div className="stat-val mono">{formatUsd(summary.totalUsd)}</div>
            {/* Ноль при непустой статистике читался как сломанный счётчик —
                объясняем, откуда он берётся. */}
            {summary.totalUsd === 0 && summary.totalCalls > 0 && (
              <div className="cap muted" style={{ marginTop: 6 }}>
                вызовы шли через подписочный бэкенд и не тарифицировались по API
              </div>
            )}
          </div>
          <div className="card stat-card">
            <div className="cap-upper">Вызовов</div>
            <div className="stat-val mono">{summary.totalCalls}</div>
          </div>
          <div className="card stat-card">
            <div className="cap-upper">Токены: вход / выход</div>
            <div className="stat-val mono" style={{ fontSize: 24 }}>
              {fmt(summary.totalInputTokens)} / {fmt(summary.totalOutputTokens)}
            </div>
          </div>
          <div className="card stat-card">
            <div className="cap-upper">Кэш: чтение / запись</div>
            <div className="stat-val mono" style={{ fontSize: 24 }}>
              {fmt(summary.totalCacheReadTokens)} /{" "}
              {fmt(summary.totalCacheCreationTokens)}
            </div>
          </div>
        </div>

        {/* Per-route */}
        <div className="card">
          <div className="panel-head" style={{ marginBottom: 12 }}>
            <h3>По маршрутам</h3>
            <span className="cap mono faint">
              {summary.perRoute.length} маршрут.
            </span>
          </div>
          {summary.perRoute.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, fontStyle: "italic" }}>
              Нет данных в выбранном диапазоне.
            </p>
          ) : (
            <div className="usage-table">
              <table>
                <thead>
                  <tr>
                    <th>Маршрут</th>
                    <th className="num">Вызовов</th>
                    <th className="num">Стоимость</th>
                    <th className="num">Вход, токены</th>
                    <th className="num">Выход, токены</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.perRoute.map((row) => (
                    <tr key={row.route}>
                      <td className="mono">{row.route}</td>
                      <td className="num mono">{row.calls}</td>
                      <td className="num mono">{formatUsd(row.costUsd)}</td>
                      <td className="num mono">{fmt(row.inputTokens)}</td>
                      <td className="num mono">{fmt(row.outputTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Per-day */}
        <div className="card">
          <div className="panel-head" style={{ marginBottom: 12 }}>
            <h3>По дням</h3>
            <span className="cap mono faint">USD</span>
          </div>
          {summary.perDay.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, fontStyle: "italic" }}>
              Нет дней с активностью.
            </p>
          ) : (
            <PerDayBars data={summary.perDay} />
          )}
        </div>

        {/* Recent calls */}
        <div className="card">
          <div className="panel-head" style={{ marginBottom: 12 }}>
            <h3>Последние 50 вызовов</h3>
            <span className="cap mono faint">{summary.recent.length} зап.</span>
          </div>
          {summary.recent.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, fontStyle: "italic" }}>
              Пусто.
            </p>
          ) : (
            <div className="usage-table" style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Когда</th>
                    <th>Маршрут</th>
                    <th>Модель</th>
                    <th className="num">In</th>
                    <th className="num">Out</th>
                    <th className="num">Кэш чт./зап.</th>
                    <th className="num">$</th>
                    <th className="num">book/ch/v</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recent.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">
                        {new Date(r.createdAt).toLocaleString("ru-RU")}
                      </td>
                      <td className="mono">{r.route}</td>
                      <td className="mono">{r.model}</td>
                      <td className="num mono">{r.inputTokens}</td>
                      <td className="num mono">{r.outputTokens}</td>
                      <td className="num mono">
                        {r.cacheReadInputTokens}/{r.cacheCreationInputTokens}
                      </td>
                      <td className="num mono">{formatUsd(r.costUsd)}</td>
                      <td className="num mono muted">
                        {r.bookId ?? "–"}/{r.chapterId ?? "–"}/
                        {r.versionId ?? "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PerDayBars({
  data,
}: {
  data: Array<{ date: string; costUsd: number; calls: number }>;
}) {
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const max = Math.max(...sorted.map((d) => d.costUsd), 0.0001);
  // Все нули — рисовать полосы нулевой длины бессмысленно: это выглядит как
  // не отрисовавшийся график.
  const allZero = sorted.every((d) => d.costUsd === 0);
  if (allZero) {
    return (
      <p className="muted" style={{ fontSize: 13 }}>
        Расходов за период нет — {sorted.reduce((n, d) => n + d.calls, 0)}{" "}
        вызовов прошли без списаний по API.
      </p>
    );
  }
  return (
    <div className="bar-chart">
      {sorted.map((d) => (
        <div
          key={d.date}
          className="bar-row"
          title={`${d.date}: ${formatUsd(d.costUsd)} · ${d.calls} вызовов`}
        >
          <span className="bar-label mono">{d.date.slice(5)}</span>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{
                width: `${(d.costUsd / max) * 100}%`,
                background: "var(--color-brass)",
              }}
            />
          </div>
          <span className="bar-val mono">{formatUsd(d.costUsd)}</span>
        </div>
      ))}
    </div>
  );
}
