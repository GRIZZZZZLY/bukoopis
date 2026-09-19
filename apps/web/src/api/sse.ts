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
      const dataMatch = raw.match(/^data: (.+)$/m);
      if (!dataMatch) continue;
      const event = raw.match(/^event: (.+)$/m)?.[1] ?? "message";
      let data: unknown;
      try {
        data = JSON.parse(dataMatch[1]!);
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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    flushFrames();
  }
  // Хвост без завершающего разделителя: сервер мог закрыть соединение сразу
  // после последнего кадра.
  buffer += decoder.decode();
  if (buffer.length > 0) {
    buffer += "\n\n";
    flushFrames();
  }
  return { sawTerminal };
}

/** Текст, который видит автор, когда поток оборвался молча. Один на все
 *  потоки: причина одна и та же, и звучать она должна одинаково. */
export const SSE_BROKEN_MESSAGE =
  "Связь с сервером оборвалась, и ответ не дошёл целиком. Ничего не потеряно: попробуйте ещё раз.";
