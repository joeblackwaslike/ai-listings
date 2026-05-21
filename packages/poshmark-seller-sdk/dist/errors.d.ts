export declare class PoshmarkError extends Error {
    readonly status: number | undefined;
    constructor(message: string, options?: {
        status?: number;
        cause?: unknown;
    });
}
export declare class PoshmarkCookieError extends PoshmarkError {
    constructor(message: string);
}
export declare class PoshmarkHttpError extends PoshmarkError {
    constructor(message: string, options: {
        status: number;
        cause?: unknown;
    });
}
export declare class PoshmarkDataError extends PoshmarkError {
    constructor(message: string, options?: {
        status?: number;
        cause?: unknown;
    });
}
//# sourceMappingURL=errors.d.ts.map