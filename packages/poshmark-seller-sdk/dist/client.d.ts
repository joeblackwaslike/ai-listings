import type { ClosetListingsResult, GetClosetListingsOptions, PoshmarkClientOptions, PoshmarkListing, PoshmarkRequestOptions, PoshmarkSessionUser, SalesPage, UpdateListingFields } from "./types.js";
export declare class PoshmarkClient {
    private readonly baseUrl;
    private readonly cookieHeader;
    private readonly fetchImpl;
    private readonly requestDelayMs;
    private readonly user;
    private readonly userAgent;
    private lastRequestAt;
    constructor(options: PoshmarkClientOptions);
    getSessionUser(): PoshmarkSessionUser;
    getClosetListings(options?: GetClosetListingsOptions): Promise<ClosetListingsResult>;
    getListing(id: string): Promise<PoshmarkListing>;
    updateListing(id: string, fields: UpdateListingFields): Promise<void>;
    getSalesPage(maxId?: string): Promise<SalesPage>;
    getOrderDetailHtml(orderId: string): Promise<string>;
    requestJson<T>(options: PoshmarkRequestOptions): Promise<T>;
    requestText(options: PoshmarkRequestOptions): Promise<string>;
    private getClosetListingsPage;
    private getEditListingCsrfToken;
    private request;
    private buildUrl;
    private throttle;
}
//# sourceMappingURL=client.d.ts.map