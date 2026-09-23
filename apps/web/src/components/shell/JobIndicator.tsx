import { useEffect, useState } from "react";
import { useJob } from "@/lib/jobs";

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Идущая работа модели: что, сколько идёт, сколько стоит, «Стоп».
 *  Без работы не рисуется ничего. */
export function JobIndicator() {
  const job = useJob();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!job) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [job]);
  if (!job) return null;
  return (
    <div className="job" role="status" aria-live="polite">
      <span className="job-flame" aria-hidden="true" />
      <span className="job-label">{job.label}</span>
      <span className="job-time mono">{elapsed(now - job.startedAt)}</span>
      {job.costLabel && <span className="job-cost mono">{job.costLabel}</span>}
      {job.onStop && (
        <button type="button" className="job-stop" onClick={job.onStop}>
          Стоп
        </button>
      )}
    </div>
  );
}
