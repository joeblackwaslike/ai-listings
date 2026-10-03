import { inngest } from "@/lib/inngest/client";
import { getSupabaseAdmin } from "@/lib/pipeline/supabase-push";
import { EbayAdapter } from "@/lib/platforms/adapters/ebay";
import { getEbayCreds } from "@/lib/platforms/credentials";

const EBAY_LISTING_ID_RE = /\/itm\/(\d+)/;

function extractListingId(url: string): string | null {
	return EBAY_LISTING_ID_RE.exec(url)?.[1] ?? null;
}

export const syncEbayPrices = inngest.createFunction(
	{
		id: "sync-ebay-prices",
		name: "Sync eBay Prices",
		triggers: [{ cron: "0 */6 * * *" }, { event: "sync/ebay-prices" }],
	},
	async ({ step }) => {
		await step.run("sync-prices", async () => {
			const supabase = getSupabaseAdmin();

			const { data: rows } = await supabase
				.from("user_settings")
				.select("user_id")
				.eq("setting_key", "ebay_refresh_token")
				.not("setting_value", "is", null);
			const userIds = (rows ?? []).map((r) => r.user_id as string);
			console.log(
				`[sync-ebay-prices] users with eBay creds: ${userIds.length}`,
			);

			for (const userId of userIds) {
				try {
					const creds = await getEbayCreds(userId);
					if (!creds) continue;

					const { data: dbListings, error: dbError } = await supabase
						.from("listings")
						.select("id, sku, final_price_cents, listing_urls")
						.eq("user_id", userId)
						.eq("status", "published")
						.not("listing_urls->>ebay", "is", null);
					if (dbError) throw dbError;
					if (!dbListings || dbListings.length === 0) {
						console.log(
							`[sync-ebay-prices] userId=${userId}: no published listings with eBay URLs`,
						);
						continue;
					}
					console.log(
						`[sync-ebay-prices] userId=${userId}: checking ${dbListings.length} listings`,
					);

					// Extract listingId from stored eBay URL (https://www.ebay.com/itm/{listingId})
					const listingIdToDbRow = new Map<
						string,
						(typeof dbListings)[number]
					>();
					for (const row of dbListings) {
						const ebayUrl = (row.listing_urls as Record<string, string> | null)
							?.ebay;
						if (!ebayUrl) continue;
						const listingId = extractListingId(ebayUrl);
						if (listingId) listingIdToDbRow.set(listingId, row);
					}

					if (listingIdToDbRow.size === 0) {
						console.log(
							`[sync-ebay-prices] userId=${userId}: no parseable listing IDs`,
						);
						continue;
					}

					const adapter = new EbayAdapter(creds);
					const priceMap = await adapter.getPricesByListingId([
						...listingIdToDbRow.keys(),
					]);
					console.log(
						`[sync-ebay-prices] userId=${userId}: got prices for ${priceMap.size}/${listingIdToDbRow.size} listings`,
					);

					let updated = 0;
					for (const [listingId, ebayPrice] of priceMap) {
						const row = listingIdToDbRow.get(listingId);
						if (!row) continue;
						if (ebayPrice === row.final_price_cents) continue;

						const { error: updateError } = await supabase
							.from("listings")
							.update({ final_price_cents: ebayPrice })
							.eq("id", row.id);
						if (updateError) throw updateError;
						console.log(
							`[sync-ebay-prices] updated sku=${row.sku}: ${row.final_price_cents} → ${ebayPrice}`,
						);
						updated++;
					}
					console.log(
						`[sync-ebay-prices] userId=${userId}: updated ${updated} prices`,
					);
				} catch (err) {
					console.error(`[sync-ebay-prices] error for userId=${userId}:`, err);
				}
			}
		});
	},
);
