import { describe, it, expect, vi } from "vitest";
import { PoshmarkClient } from "../client.js";

const SESSION_COOKIE =
  "ui=" + encodeURIComponent(JSON.stringify({ uid: "abc123", dh: "testuser" })) + "; _posh_sess=test";

const LISTING_ID = "6ac048faf314c27d3bad0a78";
const CSRF_HTML = `<html><head><meta id="csrftoken" content="test-csrf-token"></head></html>`;

function makeClient(fetchImpl: typeof fetch): PoshmarkClient {
  return new PoshmarkClient({ cookie: SESSION_COOKIE, fetch: fetchImpl, requestDelayMs: 0 });
}

function fetchStub() {
  return vi.fn().mockImplementation((rawUrl: string | URL) => {
    const isEditPage = new URL(String(rawUrl)).pathname.startsWith("/edit-listing/");
    return Promise.resolve(
      isEditPage
        ? new Response(CSRF_HTML, { status: 200, headers: { "Content-Type": "text/html" } })
        : new Response('{"trace_id":"t"}', { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  });
}

describe("PoshmarkClient.updateListing", () => {
  it("posts only the changed price as whole-dollar price_amount", async () => {
    const fetchImpl = fetchStub();

    await makeClient(fetchImpl as unknown as typeof fetch).updateListing(LISTING_ID, { price: 171.72 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[1];
    expect(new URL(String(url)).pathname).toBe(`/vm-rest/posts/${LISTING_ID}`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      post: { price_amount: { val: 171, currency_code: "USD", currency_symbol: "$" } },
    });
  });

  it("sends only the fields it was given", async () => {
    const fetchImpl = fetchStub();

    await makeClient(fetchImpl as unknown as typeof fetch).updateListing(LISTING_ID, { title: "New title" });

    const [, init] = fetchImpl.mock.calls[1];
    expect(JSON.parse(init.body as string)).toEqual({ post: { title: "New title" } });
  });

  it("rejects an update with no fields", async () => {
    const fetchImpl = fetchStub();

    await expect(makeClient(fetchImpl as unknown as typeof fetch).updateListing(LISTING_ID, {})).rejects.toThrow(
      "at least one field",
    );
  });

  it("accepts the adapter's \"171.72 USD\" price string", async () => {
    const fetchImpl = fetchStub();

    await makeClient(fetchImpl as unknown as typeof fetch).updateListing(LISTING_ID, { price: "171.72 USD" });

    const [, init] = fetchImpl.mock.calls[1];
    expect(JSON.parse(init.body as string).post.price_amount.val).toBe(171);
  });

  it.each(["abc", "", -5, Number.NaN])("rejects invalid price %s before any request", async (price) => {
    const fetchImpl = fetchStub();

    await expect(makeClient(fetchImpl as unknown as typeof fetch).updateListing(LISTING_ID, { price })).rejects.toThrow(
      "Invalid price",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("PoshmarkClient.getListing", () => {
  it("unwraps the data envelope and reads price_amount", async () => {
    const body = { data: { id: LISTING_ID, title: "Card holder", price_amount: { val: "190.0" } }, meta: {} };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const listing = await makeClient(fetchImpl as unknown as typeof fetch).getListing(LISTING_ID);

    expect(listing).toMatchObject({ id: LISTING_ID, title: "Card holder", price: "190.00 USD" });
  });
});
