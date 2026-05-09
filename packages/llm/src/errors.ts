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
