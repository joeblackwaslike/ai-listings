export class PoshmarkError extends Error {
    status;
    constructor(message, options = {}) {
        super(message, { cause: options.cause });
        this.name = "PoshmarkError";
        this.status = options.status;
    }
}
export class PoshmarkCookieError extends PoshmarkError {
    constructor(message) {
        super(message);
        this.name = "PoshmarkCookieError";
    }
}
export class PoshmarkHttpError extends PoshmarkError {
    constructor(message, options) {
        super(message, options);
        this.name = "PoshmarkHttpError";
    }
}
export class PoshmarkDataError extends PoshmarkError {
    constructor(message, options = {}) {
        super(message, options);
        this.name = "PoshmarkDataError";
    }
}
//# sourceMappingURL=errors.js.map