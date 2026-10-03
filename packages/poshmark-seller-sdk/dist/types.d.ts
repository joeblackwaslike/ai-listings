export type PoshmarkCookies = Readonly<Record<string, string>>;
export interface PoshmarkSessionUser {
    readonly id: string;
    readonly username: string;
    readonly email?: string;
    readonly fullName?: string;
}
export interface PoshmarkClientOptions {
    readonly cookie: string | PoshmarkCookies;
    readonly baseUrl?: string;
    readonly userAgent?: string;
    readonly fetch?: typeof fetch;
    readonly requestDelayMs?: number;
}
export interface PoshmarkRequestOptions {
    readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    readonly path: string;
    readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
    readonly headers?: HeadersInit;
    readonly body?: unknown;
    readonly referer?: string;
    readonly accept?: string;
    readonly csrfToken?: string;
}
export interface PoshmarkPaginatedResponse<T> {
    readonly data: readonly T[];
    readonly more?: {
        readonly next_max_id?: string | number | null;
    };
}
export interface PoshmarkListing {
    readonly id: string;
    readonly title: string;
    readonly description?: string;
    readonly price?: string;
    readonly brand?: string;
    readonly size?: string;
    readonly status?: string;
    readonly imageUrl?: string;
    readonly raw: Record<string, unknown>;
}
export interface GetClosetListingsOptions {
    readonly username?: string;
    readonly userId?: string;
    readonly limit?: number;
    readonly pageDelayMs?: number;
}
export interface ClosetListingsResult {
    readonly items: readonly PoshmarkListing[];
    readonly partial: boolean;
}
export interface UpdateListingFields {
    readonly title?: string;
    readonly description?: string;
    readonly price?: string | number;
    readonly brand?: string;
}
export interface PoshmarkCreateListingParams {
    readonly title: string;
    readonly description: string;
    readonly priceCents: number;
    readonly condition: string;
    readonly brand: string;
    readonly sku: string;
    readonly imageUrls: string[];
    readonly departmentId: string;
    readonly categoryId: string;
    readonly subcategoryId?: string;
    readonly colors: string[];
    readonly styleTags: string[];
    readonly size: string;
    readonly originalPriceCents?: number;
    readonly minPriceCents?: number;
    readonly smartSell?: boolean;
    readonly draft?: boolean;
}
export interface PoshmarkCreateListingResult {
    readonly platformId: string;
    readonly url: string;
}
export interface SalesPage {
    readonly html: string;
    readonly nextMaxId: string | null;
}
//# sourceMappingURL=types.d.ts.map