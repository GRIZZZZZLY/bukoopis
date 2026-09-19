/**
 * Один разбор SSE на все потоки приложения.
 *
 * Его было пять копий — Писатель, правка, inline, аспекты, приём материала и
 * быстрый сбор, — и только одна замечала, что поток кончился, не прислав ни
 * `done`, ни `error` (В9 ревью 2026-09-19). Остальные молча возвращались:
 * экран оставался в состоянии «идёт» навсегда, кнопка не отпускалась, а на
 * главе вдобавок было выключено автосохранение — всё, что автор печатал
 * дальше, не сохранялось до перезагрузки страницы.
 *
 * Поэтому факт «терминальное событие пришло» возвращается вызывающему, а не
 * остаётся в его собственном цикле, где его легко забыть.
 */

export interface SseEvent {
  /** Имя события; кадр без `event:` приходит как `message`. */
  event: string;
  data: unknown;
}

export interface ConsumeSseOptions {
  /** Имена событий, после которых поток считается завершённым по-честному. */
  terminalEvents: readonly string[];
}

export interface ConsumeSseResult {
  sawTerminal: boolean;
}

export async function consumeSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SseEvent) => void,
  opts: ConsumeSseOptions,
): Promise<ConsumeSseResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const terminal = new Set(opts.terminalEvents);
  let buffer = "";
  let sawTerminal = false;

  const flushFrames = (): void => {
    let sepIdx;
    while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      // Кадр SSE вправе нести несколько строк `data:`; они склеиваются через
      // перевод строки. Наши маршруты шлют одну, но брать только первую
      // значит молча терять кадр, если когда-нибудь пошлют две.
      const dataLines: string[] = [];
      let event = "message";
      for (const line of raw.split("\n")) {
        if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
        else if (line.startsWith("event:")) event = line.slice(6).trim();
      }
      if (dataLines.length === 0) continue;
      let data: unknown;
      try {
        data = JSON.parse(dataLines.join("\n"));
      } catch {
        // Один битый кадр — не повод ронять поток: дальше может прийти
        // и `done`, и остаток текста.
        continue;
      }
      if (terminal.has(event)) sawTerminal = true;
      try {
        onEvent({ event, data });
      } catch {
        // Потребитель — чужая беда. Свой поток из-за него не бросаем.
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // CRLF нормализуется сразу: разделитель кадров ищется как "\n\n", и на
      // потоке с \r\n он не находился бы ни разу — экран молчал бы до конца
      // генерации, а потом сообщил об обрыве.
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      flushFrames();
    }
    // Хвост без завершающего разделителя: сервер мог закрыть соединение сразу
    // после последнего кадра.
    buffer += decoder.decode().replace(/\r\n/g, "\n");
    if (buffer.length > 0) {
      buffer += "\n\n";
      flushFrames();
    }
  } finally {
    // Оборванное чтение бросает. Без этого поток остаётся заблокированным
    // читателем, которого уже никто не держит.
    try {
      reader.releaseLock();
    } catch {
      // Отпускать нечего — читатель уже освобождён.
    }
  }
  return { sawTerminal };
}

/** Текст, который видит автор, когда поток оборвался молча. Один на все
 *  потоки: причина одна и та же, и звучать она должна одинаково. */
export const SSE_BROKEN_MESSAGE =
  "Связь с сервером оборвалась, и ответ не дошёл целиком. Ничего не потеряно: попробуйте ещё раз.";
