/** Кто сейчас собирает черновики и кого попросили остановиться.
 *
 *  В памяти процесса, а не в БД: сбор живёт внутри одного запроса, и после
 *  перезапуска останавливать уже нечего. Ключ — книга: два одновременных
 *  сбора одной книги смысла не имеют, а разные книги друг другу не мешают. */
export interface QuickStartCancelRegistry {
  begin: (bookId: number) => void;
  /** true, если такой сбор идёт и его пометили на остановку. */
  requestStop: (bookId: number) => boolean;
  shouldStop: (bookId: number) => boolean;
  end: (bookId: number) => void;
  size: () => number;
}

export function createQuickStartCancelRegistry(): QuickStartCancelRegistry {
  const stopping = new Map<number, boolean>();
  return {
    begin: (bookId) => {
      stopping.set(bookId, false);
    },
    requestStop: (bookId) => {
      if (!stopping.has(bookId)) return false;
      stopping.set(bookId, true);
      return true;
    },
    shouldStop: (bookId) => stopping.get(bookId) === true,
    end: (bookId) => {
      stopping.delete(bookId);
    },
    size: () => stopping.size,
  };
}
