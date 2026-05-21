import { PoshmarkCookieError } from "./errors.js";
const COOKIE_ALLOWLIST = new Set([
    "_csrf",
    "__ssid",
    "exp",
    "ui",
    "_uetsid",
    "_web_session",
    "jwt",
]);
export function parseCookieHeader(cookie) {
    if (typeof cookie !== "string") {
        return cookie;
    }
    const normalized = cookie.trim().replace(/^["']|["']$/g, "");
    const entries = normalized
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((part) => {
        const separatorIndex = part.indexOf("=");
        if (separatorIndex === -1) {
            return [decodeURIComponent(part), ""];
        }
        const key = part.slice(0, separatorIndex).trim();
        const value = part.slice(separatorIndex + 1).trim();
        return [decodeURIComponent(key), decodeURIComponent(value)];
    });
    return Object.fromEntries(entries);
}
export function toCookieHeader(cookies) {
    return Object.entries(cookies)
        .filter(([name, value]) => COOKIE_ALLOWLIST.has(name) && value.length > 0)
        .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
        .join("; ");
}
export function parseSessionUser(cookies) {
    const uiCookie = cookies["ui"];
    if (!uiCookie) {
        throw new PoshmarkCookieError("Missing required Poshmark ui cookie");
    }
    const parsed = parseJsonObject(uiCookie, "ui cookie");
    const id = readString(parsed, "uid");
    const username = readString(parsed, "dh");
    const email = readOptionalString(parsed, "em");
    const encodedFullName = readOptionalString(parsed, "fn");
    return {
        id,
        username,
        ...(email ? { email } : {}),
        ...(encodedFullName ? { fullName: decodeURIComponent(encodedFullName) } : {}),
    };
}
function parseJsonObject(value, label) {
    try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed;
        }
    }
    catch (error) {
        throw new PoshmarkCookieError(`Invalid ${label}: ${error.message}`);
    }
    throw new PoshmarkCookieError(`Invalid ${label}: expected JSON object`);
}
function readString(source, key) {
    const value = source[key];
    if (typeof value !== "string" || value.length === 0) {
        throw new PoshmarkCookieError(`Missing required Poshmark ui cookie field: ${key}`);
    }
    return value;
}
function readOptionalString(source, key) {
    const value = source[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
//# sourceMappingURL=cookies.js.map