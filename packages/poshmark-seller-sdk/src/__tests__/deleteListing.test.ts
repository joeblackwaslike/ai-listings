import { describe, it, expect, vi } from "vitest";
import { PoshmarkClient } from "../client.js";
import { PoshmarkDataError } from "../errors.js";

const SESSION_COOKIE =
  "ui=" + encodeURIComponent(JSON.stringify({ uid: "abc123", dh: "testuser" })) + "; _posh_sess=test";

const LISTING_ID = "6ac048faf314c27d3bad0a78";
const CSRF_HTML = `<html><head><meta id="csrftoken" content="test-csrf-token"></head></html>`;

function htmlResp(html: string): Response {
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
}

function makeClient(fetchImpl: typeof fetch): PoshmarkClient {
  return new PoshmarkClient({ cookie: SESSION_COOKIE, fetch: fetchImpl, requestDelayMs: 0 });
}

describe("PoshmarkClient.deleteListing", () => {
  it("fetches the edit-listing CSRF token, then sends DELETE with X-XSRF-TOKEN", async () => {
    const fetchImpl = vi.fn().mockImplementation((rawUrl: string | URL) => {
      const url = new URL(String(rawUrl));
      return Promise.resolve(
        url.pathname.startsWith("/edit-listing/") ? htmlResp(CSRF_HTML) : new Response("{}", { status: 200 }),
      );
    });

    await makeClient(fetchImpl as unknown as typeof fetch).deleteListing(LISTING_ID);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [csrfUrl, csrfInit] = fetchImpl.mock.calls[0];
    expect(new URL(String(csrfUrl)).pathname).toBe(`/edit-listing/${LISTING_ID}`);
    expect(csrfInit.method).toBe("GET");

    const [deleteUrl, deleteInit] = fetchImpl.mock.calls[1];
    const parsed = new URL(String(deleteUrl));
    expect(parsed.pathname).toBe(`/vm-rest/posts/${LISTING_ID}`);
    expect(parsed.searchParams.get("app_version")).toBe("2.55");
    expect(parsed.searchParams.get("app_type")).toBe("web");
    expect(deleteInit.method).toBe("DELETE");
    expect((deleteInit.headers as Headers).get("X-XSRF-TOKEN")).toBe("test-csrf-token");
  });

  it("throws and sends no DELETE when the CSRF token is missing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(htmlResp("<html><head></head></html>"));

    await expect(makeClient(fetchImpl as unknown as typeof fetch).deleteListing(LISTING_ID)).rejects.toBeInstanceOf(
      PoshmarkDataError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
