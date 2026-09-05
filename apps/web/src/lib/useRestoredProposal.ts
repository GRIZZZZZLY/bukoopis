import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { ProseChange, ProseProposal } from "@book-forge/shared";

export interface RestoredProposal {
  proposal: ProseProposal;
  changes: ProseChange[];
}

/** Кандидат живёт в `prose_proposals`, а не во вкладке. Пока принятие не
 *  состоялось, перезагрузка страницы теряла его целиком: поток кончился,
 *  панель не смонтировалась заново, и написанная глава оставалась висеть в
 *  базе непринятой и невидимой. Спрашиваем список при монтировании и берём
 *  самый свежий неулаженный — `listProposals` отдаёт их сверху вниз.
 *
 *  Отказ маршрута — не беда экрана главы: молчим и ничего не предлагаем. */
export function useRestoredProposal(chapterId: number): RestoredProposal | null {
  const [restored, setRestored] = useState<RestoredProposal | null>(null);

  useEffect(() => {
    let dropped = false;
    setRestored(null);
    void (async () => {
      try {
        const list = await api.listProposals(chapterId);
        const pending = list.find(
          (p) => p.status === "ready" || p.status === "incomplete",
        );
        if (!pending || dropped) return;
        const { changes } = await api.getProposalChanges(pending.id);
        if (dropped) return;
        setRestored({ proposal: pending, changes });
      } catch {
        /* нет маршрута, нет сети — экран главы это не ломает */
      }
    })();
    return () => {
      dropped = true;
    };
  }, [chapterId]);

  return restored;
}
