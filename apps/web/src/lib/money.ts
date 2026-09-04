/** Деньги в интерфейсе.
 *
 *  Раньше расходы печатались как `$${v.toFixed(4)}` в семи местах, поэтому
 *  бесплатный подписочный бэкенд рисовал колонку из «$0.0000» — читается как
 *  сломанный счётчик, а не как «денег не потрачено». Точность теперь зависит
 *  от величины: ноль — это ноль, копейки не прячутся в округлении, крупные
 *  суммы не тонут в четырёх знаках.
 */
export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  if (value === 0) return "$0";
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs < 0.0001) return `${sign}<$0.0001`;
  if (abs < 0.01) return `${sign}$${abs.toFixed(4)}`;
  if (abs < 1) return `${sign}$${abs.toFixed(3)}`;
  return `${sign}$${abs.toFixed(2)}`;
}

/** Приблизительная оценка (прогноз, а не факт списания). */
export function formatUsdApprox(value: number | null | undefined): string {
  const s = formatUsd(value);
  return s === "—" ? s : `≈ ${s}`;
}
