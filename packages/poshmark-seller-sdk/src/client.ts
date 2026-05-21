import { parseCookieHeader, parseSessionUser, toCookieHeader } from "./cookies.js";
import { PoshmarkDataError, PoshmarkHttpError } from "./errors.js";
import type {
  ClosetListingsResult,
  GetClosetListingsOptions,
  PoshmarkClientOptions,
  PoshmarkListing,
  PoshmarkPaginatedResponse,
  PoshmarkRequestOptions,
  PoshmarkSessionUser,
  SalesPage,
  UpdateListingFields,
} from "./types.js";

const DEFAULT_BASE_URL = "https://poshmark.com";
const DEFAULT_REFERER = "https://poshmark.com/feed";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export class PoshmarkClient {
  private readonly baseUrl: URL;
  private readonly cookieHeader: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestDelayMs: number;
  private readonly user: PoshmarkSessionUser;
  private readonly userAgent: string;
  private lastRequestAt = 0;

  public constructor(options: PoshmarkClientOptions) {
    const cookies = parseCookieHeader(options.cookie);
    this.baseUrl = new URL(options.baseUrl ?? DEFAULT_BASE_URL);
    this.cookieHeader = toCookieHeader(cookies);
    this.fetchImpl = options.fetch ?? fetch;
    this.requestDelayMs = options.requestDelayMs ?? 250;
    this.user = parseSessionUser(cookies);
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  public getSessionUser(): PoshmarkSessionUser {
    return this.user;
  }

  public async getClosetListings(options: GetClosetListingsOptions = {}): Promise<ClosetListingsResult> {
    const userId = options.userId ?? this.user.id;
    const username = options.username ?? this.user.username;
    const limit = options.limit ?? 500;
    const pageDelayMs = options.pageDelayMs ?? 100;
    const items: PoshmarkListing[] = [];
    let maxId: string | number | null | undefined;
    let partial = false;

    while (items.length < limit) {
      const page = await this.getClosetListingsPage(userId, username, maxId);
      if (!page.data.length) {
        break;
      }

      for (const item of page.data) {
        items.push(normalizeListing(item));
        if (items.length >= limit) {
          partial = Boolean(page.more?.next_max_id);
          break;
        }
      }

      maxId = page.more?.next_max_id;
      if (!maxId) {
        break;
      }

      await sleep(pageDelayMs);
    }

    return {
      items,
      partial,
    };
  }

  public async getListing(id: string): Promise<PoshmarkListing> {
    assertNonEmpty(id, "id");
    const raw = await this.requestJson<Record<string, unknown>>({
      path: `/vm-rest/posts/${encodeURIComponent(id)}`,
      query: {
        app_version: "2.55",
        _: Date.now(),
      },
      referer: DEFAULT_REFERER,
    });

    return normalizeListing(raw);
  }

  public async updateListing(id: string, fields: UpdateListingFields): Promise<void> {
    assertNonEmpty(id, "id");
    assertUpdateFields(fields);

    const existing = await this.requestJson<Record<string, unknown>>({
      path: `/vm-rest/posts/${encodeURIComponent(id)}`,
      query: {
        app_version: "2.55",
        _: Date.now(),
      },
      referer: DEFAULT_REFERER,
    });
    const csrfToken = await this.getEditListingCsrfToken(id);
    const post = mergeListingForUpdate(existing, fields);

    await this.requestText({
      method: "POST",
      path: `/vm-rest/posts/${encodeURIComponent(id)}`,
      body: { post },
      headers: {
        "Content-Type": "application/json",
      },
      referer: `${this.baseUrl.origin}/edit-listing/${encodeURIComponent(id)}`,
      csrfToken,
    });
  }

  public async getSalesPage(maxId?: string): Promise<SalesPage> {
    const response = await this.requestJson<Record<string, unknown>>({
      path: "/order/sales",
      query: {
        _: Date.now(),
        max_id: maxId,
      },
      accept: "application/json",
      referer: DEFAULT_REFERER,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    const html = readString(response, "html");
    const nextMaxId = readNullableString(response, "max_id");

    return { html, nextMaxId };
  }

  public async getOrderDetailHtml(orderId: string): Promise<string> {
    assertNonEmpty(orderId, "orderId");
    return this.requestText({
      path: `/order/sales/${encodeURIComponent(orderId)}`,
      query: {
        _: Date.now(),
      },
      accept: "text/html",
      referer: DEFAULT_REFERER,
    });
  }

  public async requestJson<T>(options: PoshmarkRequestOptions): Promise<T> {
    const response = await this.request(options);
    const text = await response.text();

    try {
      const parsed: unknown = JSON.parse(text);
      if (isPoshmarkErrorPayload(parsed)) {
        throw new PoshmarkHttpError(
          `Poshmark returned ${parsed.error.statusCode}: ${parsed.error.errorMessage ?? parsed.error.errorType}`,
          { status: parsed.error.statusCode },
        );
      }

      return parsed as T;
    } catch (error) {
      if (error instanceof PoshmarkHttpError) {
        throw error;
      }

      throw new PoshmarkDataError("Poshmark returned invalid JSON", {
        status: response.status,
        cause: error,
      });
    }
  }

  public async requestText(options: PoshmarkRequestOptions): Promise<string> {
    const response = await this.request(options);
    const text = await response.text();
    if (text.trim().length === 0) {
      throw new PoshmarkDataError("Poshmark returned an empty response body", {
        status: response.status,
      });
    }

    return text;
  }

  private async getClosetListingsPage(
    userId: string,
    username: string,
    maxId: string | number | null | undefined,
  ): Promise<PoshmarkPaginatedResponse<Record<string, unknown>>> {
    return this.requestJson<PoshmarkPaginatedResponse<Record<string, unknown>>>({
      path: `/vm-rest/users/${encodeURIComponent(userId)}/posts`,
      query: {
        app_version: "2.55",
        format: "json",
        username,
        nm: "cl_all",
        summarize: true,
        _: Date.now(),
        max_id: maxId ?? undefined,
      },
      referer: DEFAULT_REFERER,
    });
  }

  private async getEditListingCsrfToken(id: string): Promise<string> {
    const html = await this.requestText({
      path: `/edit-listing/${encodeURIComponent(id)}`,
      query: {
        _: Date.now(),
      },
      accept: "text/html",
      referer: DEFAULT_REFERER,
    });
    const match = html.match(/<meta[^>]+id=["']csrftoken["'][^>]+content=["']([^"']+)["']/i);
    if (!match?.[1]) {
      throw new PoshmarkDataError("Could not find edit-listing CSRF token");
    }

    return match[1];
  }

  private async request(options: PoshmarkRequestOptions): Promise<Response> {
    await this.throttle();

    const url = this.buildUrl(options.path, options.query);
    const headers = new Headers(options.headers);
    headers.set("Accept", options.accept ?? "application/json, text/javascript, */*; q=0.01");
    headers.set("Accept-Language", "en-US,en;q=0.5");
    headers.set("Cookie", this.cookieHeader);
    headers.set("Referer", options.referer ?? DEFAULT_REFERER);
    headers.set("User-Agent", this.userAgent);

    if (options.csrfToken) {
      headers.set("X-XSRF-TOKEN", options.csrfToken);
    }

    const requestInit: RequestInit = {
      method: options.method ?? "GET",
      headers,
    };
    const body = serializeBody(options.body, headers);
    if (body !== undefined) {
      requestInit.body = body;
    }

    const response = await this.fetchImpl(url, requestInit);

    if (!response.ok) {
      throw new PoshmarkHttpError(`Poshmark request failed with HTTP ${response.status}`, {
        status: response.status,
      });
    }

    return response;
  }

  private buildUrl(path: string, query: PoshmarkRequestOptions["query"]): URL {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    return url;
  }

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < this.requestDelayMs) {
      await sleep(this.requestDelayMs - elapsed);
    }

    this.lastRequestAt = Date.now();
  }
}

function serializeBody(body: unknown, headers: Headers): BodyInit | undefined {
  if (body === undefined) {
    return undefined;
  }

  if (typeof body === "string" || body instanceof FormData || body instanceof URLSearchParams) {
    return body;
  }

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return JSON.stringify(body);
}

function normalizeListing(raw: Record<string, unknown>): PoshmarkListing {
  const description = readOptionalFirstString(raw, ["description", "description_text"]);
  const price = readPrice(raw);
  const brand = readNestedDisplay(raw, "brand");
  const size = readNestedDisplay(raw, "size");
  const status = readOptionalFirstString(raw, ["status"]);
  const imageUrl = readImageUrl(raw);

  return {
    id: readFirstString(raw, ["id", "post_id", "inventory_unit_id"]),
    title: readFirstString(raw, ["title"]),
    ...(description ? { description } : {}),
    ...(price ? { price } : {}),
    ...(brand ? { brand } : {}),
    ...(size ? { size } : {}),
    ...(status ? { status } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    raw,
  };
}

function mergeListingForUpdate(raw: Record<string, unknown>, fields: UpdateListingFields): Record<string, unknown> {
  const post = { ...raw };

  if (fields.title !== undefined) {
    post["title"] = fields.title;
  }

  if (fields.description !== undefined) {
    post["description"] = fields.description;
  }

  if (fields.price !== undefined) {
    post["price"] = typeof fields.price === "number" ? `${fields.price.toFixed(2)} USD` : fields.price;
  }

  if (fields.brand !== undefined) {
    const existingBrand = post["brand"];
    post["brand"] =
      existingBrand && typeof existingBrand === "object" && !Array.isArray(existingBrand)
        ? { ...existingBrand, display: fields.brand }
        : { display: fields.brand };
  }

  return post;
}

function assertUpdateFields(fields: UpdateListingFields): void {
  if (
    fields.title === undefined &&
    fields.description === undefined &&
    fields.price === undefined &&
    fields.brand === undefined
  ) {
    throw new PoshmarkDataError("updateListing requires at least one field");
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new PoshmarkDataError(`${name} must be non-empty`);
  }
}

function readFirstString(source: Record<string, unknown>, keys: readonly string[]): string {
  const value = readOptionalFirstString(source, keys);
  if (!value) {
    throw new PoshmarkDataError(`Missing expected listing field: ${keys.join(" | ")}`);
  }

  return value;
}

function readOptionalFirstString(source: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value === "string") {
    return value;
  }

  throw new PoshmarkDataError(`Missing expected response field: ${key}`);
}

function readNullableString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (value === null || value === undefined || value === "" || value === -1) {
    return null;
  }

  return String(value);
}

function readNestedDisplay(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const display = (value as Record<string, unknown>)["display"];
    return typeof display === "string" && display.length > 0 ? display : undefined;
  }

  return undefined;
}

function readPrice(source: Record<string, unknown>): string | undefined {
  const value = source["price"];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (typeof value === "number") {
    return `${value.toFixed(2)} USD`;
  }

  return undefined;
}

function readImageUrl(source: Record<string, unknown>): string | undefined {
  const coverShot = source["cover_shot"];
  if (coverShot && typeof coverShot === "object" && !Array.isArray(coverShot)) {
    const url = (coverShot as Record<string, unknown>)["url"];
    return typeof url === "string" && url.length > 0 ? url : undefined;
  }

  return readOptionalFirstString(source, ["image_url", "picture_url"]);
}

function isPoshmarkErrorPayload(value: unknown): value is {
  error: { statusCode: number; errorType?: string; errorMessage?: string };
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const error = (value as Record<string, unknown>)["error"];
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return false;
  }

  return typeof (error as Record<string, unknown>)["statusCode"] === "number";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
