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
  /** Остановиться после текущего беата, СОХРАНИВ написанное. В отличие от
   *  `requestStop` сигнал не прерывается: беат дописывается. */
  requestHold: (proposalId: number) => boolean;
  shouldHold: (proposalId: number) => boolean;
  /** Сигнал для бэкендов, умеющих прерываться. Остальные его игнорируют, и
   *  тогда работает второй рубеж: результат позднего ответа не применяется. */
  signal: (proposalId: number) => AbortSignal | undefined;
  end: (proposalId: number) => void;
  size: () => number;
}

export function createProposalCancelRegistry(): ProposalCancelRegistry {
  const runs = new Map<
    number,
    { stopping: boolean; holding: boolean; controller: AbortController }
  >();

  return {
    begin: (proposalId) => {
      runs.set(proposalId, {
        stopping: false,
        holding: false,
        controller: new AbortController(),
      });
    },
    requestStop: (proposalId) => {
      const run = runs.get(proposalId);
      if (!run) return false;
      run.stopping = true;
      run.controller.abort();
      return true;
    },
    shouldStop: (proposalId) => runs.get(proposalId)?.stopping === true,
    requestHold: (proposalId) => {
      const run = runs.get(proposalId);
      if (!run) return false;
      run.holding = true;
      return true;
    },
    shouldHold: (proposalId) => runs.get(proposalId)?.holding === true,
    signal: (proposalId) => runs.get(proposalId)?.controller.signal,
    end: (proposalId) => {
      runs.delete(proposalId);
    },
    size: () => runs.size,
  };
}
