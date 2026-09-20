export class LLMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMError";
  }
}

export class BackendNotImplementedError extends LLMError {
  constructor(message?: string) {
    super(
      message ??
        "Subscription backend not implemented yet. Coming in etap 0.2.2.",
    );
    this.name = "BackendNotImplementedError";
  }
}

/** Вызов оборван нашим же таймером. Повторять бессмысленно: тот же запрос с
 *  тем же пределом упрётся в тот же предел, а четыре попытки по десять минут
 *  превращают отказ в сорок минут тишины (живой прогон 2026-09-20). Лечится
 *  бо́льшим пределом или меньшим куском работы, не повтором. */
export class LLMTimeoutError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = "LLMTimeoutError";
  }
}

export class LLMAuthError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = "LLMAuthError";
  }
}

export class LLMValidationError extends LLMError {
  constructor(
    message: string,
    public raw: unknown,
  ) {
    super(message);
    this.name = "LLMValidationError";
  }
}

export class LLMNoToolCallError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = "LLMNoToolCallError";
  }
}

export class LLMMultipleToolCallsError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = "LLMMultipleToolCallsError";
  }
}

export class LLMSchemaRetryExhaustedError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = "LLMSchemaRetryExhaustedError";
  }
}
