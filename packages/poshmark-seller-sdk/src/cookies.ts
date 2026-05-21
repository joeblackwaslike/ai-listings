import { PoshmarkCookieError } from "./errors.js";
import type { PoshmarkCookies, PoshmarkSessionUser } from "./types.js";

const COOKIE_ALLOWLIST = new Set([
  "_csrf",
  "__ssid",
  "exp",
  "ui",
  "_uetsid",
  "_web_session",
  "jwt",
]);

export function parseCookieHeader(cookie: string | PoshmarkCookies): PoshmarkCookies {
  if (typeof cookie !== "string") {
    return cookie;
  }

  const normalized = cookie.trim().replace(/^["']|["']$/g, "");
  const entries = normalized
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part): readonly [string, string] => {
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

export function toCookieHeader(cookies: PoshmarkCookies): string {
  return Object.entries(cookies)
    .filter(([name, value]) => COOKIE_ALLOWLIST.has(name) && value.length > 0)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join("; ");
}

export function parseSessionUser(cookies: PoshmarkCookies): PoshmarkSessionUser {
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

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    throw new PoshmarkCookieError(`Invalid ${label}: ${(error as Error).message}`);
  }

  throw new PoshmarkCookieError(`Invalid ${label}: expected JSON object`);
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new PoshmarkCookieError(`Missing required Poshmark ui cookie field: ${key}`);
  }

  return value;
}

function readOptionalString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
