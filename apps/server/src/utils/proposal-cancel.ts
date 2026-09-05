/** Какие запуски генерации идут сейчас и какие из них попросили остановиться.
 *
 *  В памяти процесса, а не в БД: запуск живёт внутри одного запроса, и после
 *  перезапуска останавливать уже нечего. Ключ — id предложения: он уникален
 *  глобально, так что отмена не может задеть соседний запуск. */
export interface ProposalCancelRegistry {
  begin: (proposalId: number) => void;
  /** true, если такой запуск идёт и его пометили на остановку. */
  requestStop: (proposalId: number) => boolean;
  shouldStop: (proposalId: number) => boolean;
  /** Сигнал для бэкендов, умеющих прерываться. Остальные его игнорируют, и
   *  тогда работает второй рубеж: результат позднего ответа не применяется. */
  signal: (proposalId: number) => AbortSignal | undefined;
  end: (proposalId: number) => void;
  size: () => number;
}

export function createProposalCancelRegistry(): ProposalCancelRegistry {
  const runs = new Map<number, { stopping: boolean; controller: AbortController }>();

  return {
    begin: (proposalId) => {
      runs.set(proposalId, { stopping: false, controller: new AbortController() });
    },
    requestStop: (proposalId) => {
      const run = runs.get(proposalId);
      if (!run) return false;
      run.stopping = true;
      run.controller.abort();
      return true;
    },
    shouldStop: (proposalId) => runs.get(proposalId)?.stopping === true,
    signal: (proposalId) => runs.get(proposalId)?.controller.signal,
    end: (proposalId) => {
      runs.delete(proposalId);
    },
    size: () => runs.size,
  };
}
