import type { PoshmarkCookies, PoshmarkSessionUser } from "./types.js";
export declare function parseCookieHeader(cookie: string | PoshmarkCookies): PoshmarkCookies;
export declare function toCookieHeader(cookies: PoshmarkCookies): string;
export declare function parseSessionUser(cookies: PoshmarkCookies): PoshmarkSessionUser;
//# sourceMappingURL=cookies.d.ts.map