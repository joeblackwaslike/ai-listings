import { describe, it, expect, vi, beforeEach } from "vitest";
import { PoshmarkClient } from "../client.js";

// ui cookie must contain uid (user id) and dh (display handle/username)
const SESSION_COOKIE =
  "ui=" + encodeURIComponent(JSON.stringify({ uid: "abc123", dh: "testuser" })) + "; _posh_sess=test";

const CSRF_HTML = `<html><head><meta id="csrftoken" content="test-csrf-token"></head></html>`;
const DRAFT_ID = "6ac048faf314c27d3bad0a78";
const PHOTO_ID_1 = "6ac04ba7b552233b7addbbc2";
const PHOTO_ID_2 = "6ac04ba7b552233b7addbbc3";
const PHOTO_URL_1 = "https://example.com/photo1.jpg";
const PHOTO_URL_2 = "https://example.com/photo2.jpg";
const PHOTO_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // minimal JPEG header

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function htmlResp(html: string): Response {
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
}

/** Route fetch calls by URL so parallel uploads don't cause ordering issues. */
function makeFetchByUrl(routes: Record<string, Response | (() => Response)>): typeof fetch {
  return vi.fn().mockImplementation((rawUrl: string | URL) => {
    const url = String(rawUrl);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`Unexpected fetch: ${url}`);
    const val = routes[key];
    return Promise.resolve(typeof val === "function" ? val() : val);
  }) as unknown as typeof fetch;
}

function s(u: string | URL): string {
  return String(u);
}

const BASE_PARAMS = {
  title: "Test Sneakers",
  description: "Great condition sneakers",
  priceCents: 5500,
  condition: "ug",
  brand: "Nike",
  sku: "AB-0001",
  imageUrls: [PHOTO_URL_1],
  departmentId: "000e8975d97b4e80ef00a955",
  categoryId: "00268975d97b4e80ef00a955",
  subcategoryId: "01109287d97b4e80ef00a955",
  colors: ["White", "Black"],
  styleTags: ["Sneakers", "Casual"],
  size: "10",
  originalPriceCents: 12000,
  minPriceCents: 3500,
  smartSell: true,
};

describe("PoshmarkClient.createListing", () => {
  function makeClient(fetchImpl: typeof fetch): PoshmarkClient {
    return new PoshmarkClient({ cookie: SESSION_COOKIE, fetch: fetchImpl, requestDelayMs: 0 });
  }

  it("returns platformId and url from the draft id", async () => {
    const fetchImpl = makeFetchByUrl({
      "/create-listing": htmlResp(CSRF_HTML),
      "/users/abc123/posts": jsonResp({ id: DRAFT_ID }),
      [PHOTO_URL_1]: new Response(PHOTO_BYTES, { status: 200 }),
      "/media/scratch": jsonResp({ id: PHOTO_ID_1 }),
      [`/posts/${DRAFT_ID}?`]: jsonResp({ trace_id: "t1" }),
      "status/published": jsonResp({ trace_id: "t2" }),
    });

    const result = await makeClient(fetchImpl).createListing(BASE_PARAMS);

    expect(result).toEqual({
      platformId: DRAFT_ID,
      url: `https://poshmark.com/listing/${DRAFT_ID}`,
    });
  });

  it("sends X-XSRF-TOKEN on vm-rest requests", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetchImpl = vi.fn().mockImplementation((rawUrl: string | URL, init?: RequestInit) => {
      const url = s(rawUrl);
      calls.push([url, init ?? {}]);
      if (url.includes("/create-listing")) return Promise.resolve(htmlResp(CSRF_HTML));
      if (url.includes("/users/abc123/posts")) return Promise.resolve(jsonResp({ id: DRAFT_ID }));
      if (url.includes(PHOTO_URL_1)) return Promise.resolve(new Response(PHOTO_BYTES, { status: 200 }));
      if (url.includes("/media/scratch")) return Promise.resolve(jsonResp({ id: PHOTO_ID_1 }));
      if (url.includes(`/posts/${DRAFT_ID}`)) return Promise.resolve(jsonResp({ trace_id: "t" }));
      if (url.includes("status/published")) return Promise.resolve(jsonResp({ trace_id: "t" }));
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    await makeClient(fetchImpl).createListing(BASE_PARAMS);

    // All poshmark.com API calls (after the CSRF-fetching HTML GET) must have X-XSRF-TOKEN
    for (const [url, init] of calls) {
      if (url.includes("poshmark.com") && !url.includes("/create-listing")) {
        const headers = new Headers(init.headers as HeadersInit);
        expect(headers.get("x-xsrf-token"), `missing xsrf on ${url}`).toBe("test-csrf-token");
      }
    }
  });

  it("converts cents to dollar val in price_amount body", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn().mockImplementation((rawUrl: string | URL, init?: RequestInit) => {
      const url = s(rawUrl);
      if (init?.body && typeof init.body === "string") bodies.push(JSON.parse(init.body));
      if (url.includes("/create-listing")) return Promise.resolve(htmlResp(CSRF_HTML));
      if (url.includes("/users/abc123/posts")) return Promise.resolve(jsonResp({ id: DRAFT_ID }));
      if (url.includes(PHOTO_URL_1)) return Promise.resolve(new Response(PHOTO_BYTES, { status: 200 }));
      if (url.includes("/media/scratch")) return Promise.resolve(jsonResp({ id: PHOTO_ID_1 }));
      if (url.includes(`/posts/${DRAFT_ID}`)) return Promise.resolve(jsonResp({ trace_id: "t" }));
      if (url.includes("status/published")) return Promise.resolve(jsonResp({ trace_id: "t" }));
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    await makeClient(fetchImpl).createListing(BASE_PARAMS);

    const updateBody = bodies.find((b: any) => b?.post?.price_amount) as any;
    expect(updateBody.post.price_amount).toEqual({ val: 55, currency_code: "USD", currency_symbol: "$" });
    expect(updateBody.post.original_price_amount).toEqual({ val: 120, currency_code: "USD", currency_symbol: "$" });
    expect(updateBody.post.offer_auto_actions_min_price_amount).toEqual({ val: "35", currency_code: "USD" });
  });

  it("falls back to priceCents for original_price_amount when originalPriceCents is omitted", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn().mockImplementation((rawUrl: string | URL, init?: RequestInit) => {
      const url = s(rawUrl);
      if (init?.body && typeof init.body === "string") bodies.push(JSON.parse(init.body));
      if (url.includes("/create-listing")) return Promise.resolve(htmlResp(CSRF_HTML));
      if (url.includes("/users/abc123/posts")) return Promise.resolve(jsonResp({ id: DRAFT_ID }));
      if (url.includes(PHOTO_URL_1)) return Promise.resolve(new Response(PHOTO_BYTES, { status: 200 }));
      if (url.includes("/media/scratch")) return Promise.resolve(jsonResp({ id: PHOTO_ID_1 }));
      if (url.includes(`/posts/${DRAFT_ID}`)) return Promise.resolve(jsonResp({ trace_id: "t" }));
      if (url.includes("status/published")) return Promise.resolve(jsonResp({ trace_id: "t" }));
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const { originalPriceCents, ...paramsWithoutOriginalPrice } = BASE_PARAMS;

    await makeClient(fetchImpl).createListing(paramsWithoutOriginalPrice);

    const updateBody = bodies.find((b: any) => b?.post?.price_amount) as any;
    expect(updateBody.post.original_price_amount).toEqual({ val: 55, currency_code: "USD", currency_symbol: "$" });
  });

  it("places cover_shot as first photo and rest in pictures array", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn().mockImplementation((rawUrl: string | URL, init?: RequestInit) => {
      const url = s(rawUrl);
      if (init?.body && typeof init.body === "string") bodies.push(JSON.parse(init.body));
      if (url.includes("/create-listing")) return Promise.resolve(htmlResp(CSRF_HTML));
      if (url.includes("/users/abc123/posts")) return Promise.resolve(jsonResp({ id: DRAFT_ID }));
      if (url.includes(PHOTO_URL_1)) return Promise.resolve(new Response(PHOTO_BYTES, { status: 200 }));
      if (url.includes(PHOTO_URL_2)) return Promise.resolve(new Response(PHOTO_BYTES, { status: 200 }));
      if (url.includes("/media/scratch")) {
        const id = bodies.filter((b) => b == null || (b as any).post == null).length === 0 ? PHOTO_ID_2 : PHOTO_ID_1;
        return Promise.resolve(jsonResp({ id }));
      }
      if (url.includes(`/posts/${DRAFT_ID}`)) return Promise.resolve(jsonResp({ trace_id: "t" }));
      if (url.includes("status/published")) return Promise.resolve(jsonResp({ trace_id: "t" }));
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    await makeClient(fetchImpl).createListing({ ...BASE_PARAMS, imageUrls: [PHOTO_URL_1, PHOTO_URL_2] });

    const updateBody = bodies.find((b: any) => b?.post?.cover_shot) as any;
    expect(updateBody.post.cover_shot).toHaveProperty("id");
    expect(updateBody.post.pictures).toHaveLength(1);
  });

  it("uploads the photo blob under the 'file' multipart field name", async () => {
    let uploadForm: FormData | undefined;
    const fetchImpl = vi.fn().mockImplementation((rawUrl: string | URL, init?: RequestInit) => {
      const url = s(rawUrl);
      if (url.includes("/create-listing")) return Promise.resolve(htmlResp(CSRF_HTML));
      if (url.includes("/users/abc123/posts")) return Promise.resolve(jsonResp({ id: DRAFT_ID }));
      if (url.includes(PHOTO_URL_1)) return Promise.resolve(new Response(PHOTO_BYTES, { status: 200 }));
      if (url.includes("/media/scratch")) {
        uploadForm = init?.body as FormData;
        return Promise.resolve(jsonResp({ id: PHOTO_ID_1 }));
      }
      if (url.includes(`/posts/${DRAFT_ID}`)) return Promise.resolve(jsonResp({ trace_id: "t" }));
      if (url.includes("status/published")) return Promise.resolve(jsonResp({ trace_id: "t" }));
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    await makeClient(fetchImpl).createListing(BASE_PARAMS);

    expect(uploadForm).toBeInstanceOf(FormData);
    expect(uploadForm!.has("file")).toBe(true);
    expect(uploadForm!.has("img_file")).toBe(false);
    const entry = uploadForm!.get("file") as File;
    expect(entry.name).toBe("image.jpg");
  });

  it("throws if create draft returns no id", async () => {
    const fetchImpl = makeFetchByUrl({
      "/create-listing": htmlResp(CSRF_HTML),
      "/users/abc123/posts": jsonResp({ status: "ok" }), // missing id
    });

    await expect(makeClient(fetchImpl).createListing(BASE_PARAMS)).rejects.toThrow(
      "Create draft did not return a post id",
    );
  });

  it("throws if photo upload returns no id", async () => {
    const fetchImpl = makeFetchByUrl({
      "/create-listing": htmlResp(CSRF_HTML),
      "/users/abc123/posts": jsonResp({ id: DRAFT_ID }),
      [PHOTO_URL_1]: new Response(PHOTO_BYTES, { status: 200 }),
      "/media/scratch": jsonResp({ status: "ok" }), // missing id
    });

    await expect(makeClient(fetchImpl).createListing(BASE_PARAMS)).rejects.toThrow(
      "Photo upload did not return an id",
    );
  });

  it("logs the response body when a request fails with a non-ok HTTP status", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = makeFetchByUrl({
      "/create-listing": htmlResp(CSRF_HTML),
      "/users/abc123/posts": new Response('{"error":"rate limited"}', { status: 429 }),
    });

    await expect(makeClient(fetchImpl).createListing(BASE_PARAMS)).rejects.toThrow(
      "Poshmark request failed with HTTP 429",
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('{"error":"rate limited"}'));
    consoleErrorSpy.mockRestore();
  });
});
