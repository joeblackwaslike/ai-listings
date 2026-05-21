# Backlog

Task 10 — manual steps (you do these, not Claude):

Supabase dashboard → Auth → Providers → Google → Enable, paste GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET, add redirect URL http://localhost:3000/auth/callback
Apply migration — paste supabase/migrations/0002_auth_user_isolation_api_keys.sql into Supabase SQL editor and run
Add to .env.local:

GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=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

NEXT_PUBLIC_SITE_URL=http://localhost:3000
REGISTRATION_MODE=whitelist
ALLOWED_EMAILS=joeblackwaslike@gmail.com

First login — npm run dev → navigate to localhost:3000 → sign in with Google → confirm you land on /dashboard
Run seed — fill in actual key values in supabase/seed/001_owner_keys.sql, paste into Supabase SQL editor and run
Verify — go to /settings/api-keys and confirm all three providers show masked values
Smoke test — upload a photo, open workspace, chat with agent, check publish page
Once manual steps are done, close the beads issue:


bd close ai-listings-s5y --reason="Auth implemented: Google OAuth with whitelist gate, user_id isolation on listings + child tables via RLS subquery, per-user API keys in user_api_keys table, pipeline + agent thread keys from DB, settings page at /settings/api-keys."

---

create a design spec for implementing reseller platform integrations.  There will be different levels of platform support and some platforms will have things that others won't.  

I think we should start with seller tools like:
- Listing your listings
- Creating a new listing
- Editing an existing listing
- Delisting a live listing
- Relisting a listing that is no longer live
We should also include some kind of integration with orders so they can appear in an AI listings dashboard, and notifications could be sent to your email.
Another level of support would include pricing research tools. Another level of integration would be integration with the platform’s native messaging system. This is especially important if we’re going to add mechmarket because it uses Reddit DMs, and I’ve lost sales because I don’t check them often enough.
Ideally, every platform would be able to surface these messages or notifications into the AI listings dashboard. We’ll create a seller dashboard somewhere, and we’ll want to create a system that allows us to cross-list, like importing an item that already exists on one platform and listing it on other platforms. When the quantity drops to zero, it should delist from all other platforms so we don’t double-sell anything.

Some platforms offer a feature where someone can submit an offer for an item instead of buying it at the listed price. Those offers usually expire in 24 hours, and I don’t typically see the emails in time. If we can integrate with each platform to surface those offers in the solo dashboard for AIS students, that would be great.  

As far as platforms go, eBay should be very easy because there are plenty of developer APIs for eBay seller tools, and there’s even a great MCP server for it.

The other platforms are going to be more difficult because there really isn’t a public API you can have. For reverse engineering, you’d either have to find a third-party developer who created an API or SDK for an undocumented, non-public API, or use some kind of scraping tools to create the API.

That’s where we’re going to have a little more difficulty. We’ll probably have to develop the seller SDK first, and that might involve reverse engineering, or it might involve finding a developer SDK someone else wrote and translating it into the language we need. On top of that API layer is an MCP layer, and we’re hoping we can create a sort of universal API for a reseller seller platform MCP server. That way, they can use a unified interface if possible.  

- Add a feature to the item identification flow. The ability to mark a misidentified item as something else.  When doing this, it would be necessary to rewind the conversation and possibly even start over if it’s all the way to the beginning. You would also need to complete all the other steps of the pipeline again 
- Add an alternate method of ingesting product that skips the photo identification and takes instead an item description or a UPC number or a URL to a product page.  This implies building an ad item or ad product flow that gives you two options:
1. Upload photos of items
2. Enter a list of descriptions, UPCs, or URLs to product pages

- Assess the photo editing capabilities of our pipeline. Are we able to automatically rotate and crop the photos, even adjust the White balance, exposure, levels maybe.  If so then add those capabilities to the pipeline.

- Add a feature to the pricing intelligence that calculates not just the correct average pricing but also optimizes pricing to move an item faster than usual. It will probably be a percentage, but this could be category- or brand-dependent.  

- Add a feature to the pricing intelligence that looks up the average price to buy the item new if it’s still available, and whether there are any sales, special sales, discounts, or promos that might affect the aftermarket sale price.

- Add a feature to the pricing intelligence that adds a paragraph or so to the comps page explaining the methodology used to compute the suggested price. If it’s being priced to move faster than usual, include that calculation in the methodology as wel.

- Add a feature to the pricing intelligence that factors in the history of an existing listing and factors that into competing with the suggested price 

- If an item has been listed, maybe we should discount it a little every two weeks to get rid of it sooner rather than keeping it forever. Maybe it could be 10% off or something.

- Add a feature to the reseller platform integrations that searches for or takes as a configuration value a link to that platform's rules for listings.  Whenever building a new listing or editing an existing one, the different platforms' rules should be considered when publishing/posting a listing to the platform.
