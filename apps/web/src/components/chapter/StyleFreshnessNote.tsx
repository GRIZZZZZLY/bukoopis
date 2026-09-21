import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import type { StyleFreshness } from "@book-forge/shared";

interface Props {
  bookId: number;
}

/** Паспорт стиля отстаёт от рукописи (Литраб: собранный на третьей главе
 *  портрет к двадцатой тянет автора назад). Рисуется только когда после
 *  извлечения принято три и больше глав; «Пересобрать» — два шага: добор
 *  последних глав в корпус, затем прежнее извлечение. */
export function StyleFreshnessNote({ bookId }: Props) {
  const [fresh, setFresh] = useState<StyleFreshness | null>(null);
  const [phase, setPhase] = useState<"idle" | "corpus" | "extract">("idle");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFresh(await api.getStyleFreshness(bookId));
    } catch {
      setFresh(null);
    }
  }, [bookId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function rebuild(): Promise<void> {
    if (!fresh || fresh.profileId === null) return;
    setError(null);
    try {
      setPhase("corpus");
      await api.refreshStyleFromChapters(bookId);
      setPhase("extract");
      await api.runStyleExtract(fresh.profileId, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase("idle");
    }
  }

  if (!fresh || !fresh.stale) return null;

  return (
    <div className="text-sm flex flex-col gap-2">
      <p>
        С последней сборки паспорта «{fresh.profileName}» принято глав: {fresh.chaptersSince}.
        Голос книги мог уйти вперёд.
      </p>
      <Button size="sm" variant="outline" onClick={() => void rebuild()} disabled={phase !== "idle"}>
        {phase === "corpus"
          ? "Добавляю последние главы…"
          : phase === "extract"
            ? "Пересобираю паспорт…"
            : "Пересобрать по последним главам"}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
