export class PoshmarkError extends Error {
  public readonly status: number | undefined;

  public constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "PoshmarkError";
    this.status = options.status;
  }
}

export class PoshmarkCookieError extends PoshmarkError {
  public constructor(message: string) {
    super(message);
    this.name = "PoshmarkCookieError";
  }
}

export class PoshmarkHttpError extends PoshmarkError {
  public constructor(message: string, options: { status: number; cause?: unknown }) {
    super(message, options);
    this.name = "PoshmarkHttpError";
  }
}

export class PoshmarkDataError extends PoshmarkError {
  public constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options);
    this.name = "PoshmarkDataError";
  }
}
