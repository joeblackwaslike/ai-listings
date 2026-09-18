import assert from "node:assert/strict";
import { test } from "node:test";
import { EbayAdapter, mapItemSpecificsToAspects } from "./ebay";

test("mapItemSpecificsToAspects wraps each flat value in a single-element array", () => {
	const result = mapItemSpecificsToAspects({
		Brand: "Coach",
		Material: "Leather",
	});
	assert.deepEqual(result, { Brand: ["Coach"], Material: ["Leather"] });
});

test("mapItemSpecificsToAspects drops empty-string values", () => {
	const result = mapItemSpecificsToAspects({ Brand: "Coach", Color: "" });
	assert.deepEqual(result, { Brand: ["Coach"] });
});

test("mapItemSpecificsToAspects returns {} for undefined input", () => {
	assert.deepEqual(mapItemSpecificsToAspects(undefined), {});
});

test("mapItemSpecificsToAspects returns {} for an empty object", () => {
	assert.deepEqual(mapItemSpecificsToAspects({}), {});
});

// Status filter mapping tests
test('getMyListings converts internal status "active" to eBay "PUBLISHED"', async () => {
	const adapter = new EbayAdapter({
		clientId: "test",
		clientSecret: "test",
		redirectUri: "http://localhost",
	});
	let capturedUrl = "";

	// Mock getAccessToken
	adapter.getAccessToken = async () => "test-token";

	// Mock ebayFetch to capture URL and return test data
	adapter.ebayFetch = async (url: string) => {
		capturedUrl = url;
		return { offers: [] };
	};

	await adapter.getMyListings({ status: "active" });
	assert.match(
		capturedUrl,
		/status=PUBLISHED/,
		'should map "active" to "PUBLISHED"',
	);
});

test('getMyListings converts internal status "draft" to eBay "UNPUBLISHED"', async () => {
	const adapter = new EbayAdapter({
		clientId: "test",
		clientSecret: "test",
		redirectUri: "http://localhost",
	});
	let capturedUrl = "";

	adapter.getAccessToken = async () => "test-token";
	adapter.ebayFetch = async (url: string) => {
		capturedUrl = url;
		return { offers: [] };
	};

	await adapter.getMyListings({ status: "draft" });
	assert.match(
		capturedUrl,
		/status=UNPUBLISHED/,
		'should map "draft" to "UNPUBLISHED"',
	);
});

test('getMyListings converts internal status "sold" to eBay "ENDED"', async () => {
	const adapter = new EbayAdapter({
		clientId: "test",
		clientSecret: "test",
		redirectUri: "http://localhost",
	});
	let capturedUrl = "";

	adapter.getAccessToken = async () => "test-token";
	adapter.ebayFetch = async (url: string) => {
		capturedUrl = url;
		return { offers: [] };
	};

	await adapter.getMyListings({ status: "sold" });
	assert.match(capturedUrl, /status=ENDED/, 'should map "sold" to "ENDED"');
});

// Cursor pagination tests
test("getMyListings paginates through multiple pages using next URL", async () => {
	const adapter = new EbayAdapter({
		clientId: "test",
		clientSecret: "test",
		redirectUri: "http://localhost",
	});
	let callCount = 0;
	const capturedUrls: string[] = [];

	adapter.getAccessToken = async () => "test-token";
	adapter.ebayFetch = async (url: string) => {
		capturedUrls.push(url);
		callCount++;

		if (callCount === 1) {
			return {
				offers: [
					{
						listingId: "item1",
						status: "PUBLISHED",
						pricingSummary: { price: { value: "10.00" } },
					},
				],
				next: "https://api.ebay.com/sell/inventory/v1/offer?offset=100",
			};
		} else if (callCount === 2) {
			return {
				offers: [
					{
						listingId: "item2",
						status: "PUBLISHED",
						pricingSummary: { price: { value: "20.00" } },
					},
				],
			};
		}
		return { offers: [] };
	};

	const listings = await adapter.getMyListings();
	assert.equal(callCount, 2, "should make 2 API calls");
	assert.equal(listings.length, 2, "should return listings from both pages");
	assert.equal(
		listings[0].platformId,
		"item1",
		"first listing should be from first page",
	);
	assert.equal(
		listings[1].platformId,
		"item2",
		"second listing should be from second page",
	);
});

test("getOrders paginates through multiple pages using next URL", async () => {
	const adapter = new EbayAdapter({
		clientId: "test",
		clientSecret: "test",
		redirectUri: "http://localhost",
	});
	let callCount = 0;

	adapter.getAccessToken = async () => "test-token";
	adapter.ebayFetch = async () => {
		callCount++;

		if (callCount === 1) {
			return {
				orders: [
					{
						orderId: "order1",
						creationDate: new Date().toISOString(),
						orderFulfillmentStatus: "FULFILLED",
					},
				],
				next: "https://api.ebay.com/sell/fulfillment/v1/order?offset=50",
			};
		} else if (callCount === 2) {
			return {
				orders: [
					{
						orderId: "order2",
						creationDate: new Date().toISOString(),
						orderFulfillmentStatus: "FULFILLED",
					},
				],
			};
		}
		return { orders: [] };
	};

	const orders = await adapter.getOrders();
	assert.equal(callCount, 2, "should make 2 API calls");
	assert.equal(orders.length, 2, "should return orders from both pages");
});

// Status mapping from eBay to internal
test('getMyListings maps eBay "PUBLISHED" status to internal "active" status', async () => {
	// biome-ignore lint/suspicious/noExplicitAny: test mock
	const adapter = new EbayAdapter({
		clientId: "test",
		clientSecret: "test",
		refreshToken: "test",
		fulfillmentPolicyId: "test",
		paymentPolicyId: "test",
		returnPolicyId: "test",
		merchantLocationKey: "test",
		sandbox: true,
	}) as any; // biome-ignore lint/suspicious/noExplicitAny: test mock

	adapter.getAccessToken = async () => "test-token";
	adapter.ebayFetch = async () => ({
		offers: [
			{
				listingId: "item1",
				status: "PUBLISHED",
				pricingSummary: { price: { value: "10.00" } },
			},
		],
	});

	const listings = await adapter.getMyListings();
	assert.equal(listings[0].status, "active", "should map PUBLISHED to active");
});

test('getMyListings maps eBay "ENDED" status to internal "sold" status', async () => {
	const adapter = new EbayAdapter({
		clientId: "test",
		clientSecret: "test",
		refreshToken: "test",
		fulfillmentPolicyId: "test",
		paymentPolicyId: "test",
		returnPolicyId: "test",
		merchantLocationKey: "test",
		sandbox: true,
	}) as any; // biome-ignore lint/suspicious/noExplicitAny: test mock

	adapter.getAccessToken = async () => "test-token";
	adapter.ebayFetch = async () => ({
		offers: [
			{
				listingId: "item1",
				status: "ENDED",
				pricingSummary: { price: { value: "10.00" } },
			},
		],
	});

	const listings = await adapter.getMyListings();
	assert.equal(listings[0].status, "sold", "should map ENDED to sold");
});

test('getMyListings maps eBay "UNPUBLISHED" status to internal "draft" status', async () => {
	const adapter = new EbayAdapter({
		clientId: "test",
		clientSecret: "test",
		refreshToken: "test",
		fulfillmentPolicyId: "test",
		paymentPolicyId: "test",
		returnPolicyId: "test",
		merchantLocationKey: "test",
		sandbox: true,
	}) as any; // biome-ignore lint/suspicious/noExplicitAny: test mock

	adapter.getAccessToken = async () => "test-token";
	adapter.ebayFetch = async () => ({
		offers: [
			{
				listingId: "item1",
				status: "UNPUBLISHED",
				pricingSummary: { price: { value: "10.00" } },
			},
		],
	});

	const listings = await adapter.getMyListings();
	assert.equal(listings[0].status, "draft", "should map UNPUBLISHED to draft");
});

// updateListing tests for description-only vs other updates
test("updateListing with description-only change does not call inventory_item endpoint", async () => {
	const adapter = new EbayAdapter({
		clientId: "test",
		clientSecret: "test",
		refreshToken: "test",
		fulfillmentPolicyId: "test",
		paymentPolicyId: "test",
		returnPolicyId: "test",
		merchantLocationKey: "test",
		sandbox: true,
	}) as any; // biome-ignore lint/suspicious/noExplicitAny: test mock
	const capturedUrls: string[] = [];

	adapter.getAccessToken = async () => "test-token";
	adapter.ebayFetch = async (url: string) => {
		capturedUrls.push(url);
		// Return different responses based on the endpoint
		if (url.includes("/offer?listing_id=")) {
			return {
				offers: [
					{
						listingId: "item1",
						offerId: "offer-123",
						sku: "test-sku-123",
						pricingSummary: { price: { value: "10.00" } },
					},
				],
			};
		}
		return {};
	};

	await adapter.updateListing("item1", { description: "New description" });

	// Should call offer endpoint to update description
	const offerCalls = capturedUrls.filter((url) =>
		url.includes("/offer/offer-123"),
	);
	assert.equal(offerCalls.length, 1, "should call offer endpoint once");

	// Should NOT call inventory_item endpoint
	const inventoryItemCalls = capturedUrls.filter((url) =>
		url.includes("/inventory_item/"),
	);
	assert.equal(
		inventoryItemCalls.length,
		0,
		"should not call inventory_item endpoint for description-only update",
	);
});

test("updateListing with title change calls inventory_item endpoint with title but not description", async () => {
	const adapter = new EbayAdapter({
		clientId: "test",
		clientSecret: "test",
		refreshToken: "test",
		fulfillmentPolicyId: "test",
		paymentPolicyId: "test",
		returnPolicyId: "test",
		merchantLocationKey: "test",
		sandbox: true,
	}) as any; // biome-ignore lint/suspicious/noExplicitAny: test mock
	const capturedRequests: Array<{ url: string; body?: string }> = [];

	adapter.getAccessToken = async () => "test-token";
	adapter.ebayFetch = async (
		url: string,
		options?: Record<string, unknown>,
	) => {
		capturedRequests.push({
			url,
			body: typeof options?.body === "string" ? options.body : undefined,
		});
		if (url.includes("/offer?listing_id=")) {
			return {
				offers: [
					{
						listingId: "item1",
						offerId: "offer-123",
						sku: "test-sku-123",
						pricingSummary: { price: { value: "10.00" } },
					},
				],
			};
		}
		return {};
	};

	await adapter.updateListing("item1", {
		title: "New Title",
		description: "New description",
	});

	// Should call inventory_item endpoint
	const inventoryItemCall = capturedRequests.find((req) =>
		req.url.includes("/inventory_item/test-sku-123"),
	);
	assert.ok(inventoryItemCall, "should call inventory_item endpoint");

	// Parse the body and verify it contains title but not description
	if (inventoryItemCall?.body) {
		const body = JSON.parse(inventoryItemCall.body);
		assert.ok(
			body.product?.title === "New Title",
			"should include title in product",
		);
		assert.equal(
			body.product?.description,
			undefined,
			"should not include description in inventory_item product",
		);
	}
});

test("updateListing with imageUrls does not include description in inventory_item update", async () => {
	const adapter = new EbayAdapter({
		clientId: "test",
		clientSecret: "test",
		refreshToken: "test",
		fulfillmentPolicyId: "test",
		paymentPolicyId: "test",
		returnPolicyId: "test",
		merchantLocationKey: "test",
		sandbox: true,
	}) as any; // biome-ignore lint/suspicious/noExplicitAny: test mock
	const capturedRequests: Array<{ url: string; body?: string }> = [];

	adapter.getAccessToken = async () => "test-token";
	adapter.ebayFetch = async (
		url: string,
		options?: Record<string, unknown>,
	) => {
		capturedRequests.push({
			url,
			body: typeof options?.body === "string" ? options.body : undefined,
		});
		if (url.includes("/offer?listing_id=")) {
			return {
				offers: [
					{
						listingId: "item1",
						offerId: "offer-123",
						sku: "test-sku-123",
						pricingSummary: { price: { value: "10.00" } },
					},
				],
			};
		}
		return {};
	};

	await adapter.updateListing("item1", {
		imageUrls: ["http://example.com/img1.jpg"],
		description: "New description",
	});

	// Should call inventory_item endpoint
	const inventoryItemCall = capturedRequests.find((req) =>
		req.url.includes("/inventory_item/test-sku-123"),
	);
	assert.ok(inventoryItemCall, "should call inventory_item endpoint");

	// Parse the body and verify it contains imageUrls but not description
	if (inventoryItemCall?.body) {
		const body = JSON.parse(inventoryItemCall.body);
		assert.ok(
			Array.isArray(body.product?.imageUrls),
			"should include imageUrls in product",
		);
		assert.equal(
			body.product?.description,
			undefined,
			"should not include description in inventory_item product",
		);
	}
});

test("updateOfferDescription looks up offer by SKU and updates listingDescription", async () => {
	const adapter = new EbayAdapter({
		clientId: "test",
		clientSecret: "test",
		redirectUri: "http://localhost",
	});
	const capturedRequests: Array<{
		url: string;
		method?: string;
		body?: string;
	}> = [];

	adapter.getAccessToken = async () => "test-token";
	adapter.ebayFetch = async (
		url: string,
		options?: Record<string, unknown>,
	) => {
		capturedRequests.push({
			url,
			method: typeof options?.method === "string" ? options.method : "GET",
			body: typeof options?.body === "string" ? options.body : undefined,
		});
		// Return offer lookup result
		if (url.includes("/offer?sku=")) {
			return {
				offers: [
					{
						offerId: "offer-456",
						sku: "test-sku-456",
					},
				],
			};
		}
		return {};
	};

	await adapter.updateOfferDescription("test-sku-456", "Test description");

	// Should call GET /offer?sku=...
	const lookupCall = capturedRequests.find(
		(req) =>
			req.url.includes("/offer?sku=test-sku-456") && req.method === "GET",
	);
	assert.ok(lookupCall, "should call GET /offer?sku=test-sku-456");

	// Should call PUT /offer/{offerId}
	const updateCall = capturedRequests.find(
		(req) => req.url.includes("/offer/offer-456") && req.method === "PUT",
	);
	assert.ok(updateCall, "should call PUT /offer/offer-456");

	// Verify the body contains listingDescription formatted as HTML
	if (updateCall?.body) {
		const body = JSON.parse(updateCall.body);
		assert.ok(
			body.listingDescription,
			"should include listingDescription in request body",
		);
	}
});

test("updateOfferDescription throws error when no offer is found for SKU", async () => {
	const adapter = new EbayAdapter({
		clientId: "test",
		clientSecret: "test",
		redirectUri: "http://localhost",
	});

	adapter.getAccessToken = async () => "test-token";
	adapter.ebayFetch = async (url: string) => {
		// Return empty offers array
		if (url.includes("/offer?sku=")) {
			return { offers: [] };
		}
		return {};
	};

	try {
		await adapter.updateOfferDescription("nonexistent-sku", "Test description");
		assert.fail("should throw error when no offer is found");
	} catch (err) {
		assert.ok(err instanceof Error, "error should be an Error instance");
		assert.ok(
			(err as Error).message.includes("No offer found"),
			'error message should mention "No offer found"',
		);
	}
});
