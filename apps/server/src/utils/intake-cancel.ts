/** Кто сейчас разбирает материалы и кого попросили остановиться.
 *
 *  В памяти, а не в БД: разбор живёт внутри одного запроса, и если процесс
 *  перезапустился — останавливать уже нечего. Инструмент однопользовательский,
 *  одновременных разборов одной книги не бывает, но ключ включает и книгу, и
 *  запрос, чтобы «Остановить» не задело чужой разбор. */
export interface IntakeCancelRegistry {
  begin: (bookId: number, requestKey: string) => void;
  /** true, если такой разбор идёт и его пометили на остановку. */
  requestStop: (bookId: number, requestKey: string) => boolean;
  shouldStop: (bookId: number, requestKey: string) => boolean;
  end: (bookId: number, requestKey: string) => void;
  size: () => number;
}

export function createIntakeCancelRegistry(): IntakeCancelRegistry {
  const stopping = new Map<string, boolean>();
  const key = (bookId: number, requestKey: string): string =>
    `${bookId}␟${requestKey}`;

  return {
    begin: (bookId, requestKey) => {
      stopping.set(key(bookId, requestKey), false);
    },
    requestStop: (bookId, requestKey) => {
      const k = key(bookId, requestKey);
      if (!stopping.has(k)) return false;
      stopping.set(k, true);
      return true;
    },
    shouldStop: (bookId, requestKey) => stopping.get(key(bookId, requestKey)) === true,
    end: (bookId, requestKey) => {
      stopping.delete(key(bookId, requestKey));
    },
    size: () => stopping.size,
  };
}
