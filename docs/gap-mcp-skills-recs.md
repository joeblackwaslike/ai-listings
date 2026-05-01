As of April 22, 2026, this is the Claude Code install sheet I’d use.

**Prereqs**
- `claude` CLI installed and authenticated
- `node`/`npx` available
- Accounts/tokens as needed:
  - `APIFY_TOKEN`
  - `SERPAPI_API_KEY`
  - `EBAY_CLIENT_ID`
  - `EBAY_CLIENT_SECRET`
  - optional `EBAY_USER_REFRESH_TOKEN`
- If you meant `Inngest`, there is no separate official Claude Code plugin I’d recommend. The official setup is the local MCP plus the official skills.

**1. Inngest for development**
Official MCP:
```bash
npx --ignore-scripts=false inngest-cli@latest dev
claude mcp add --transport http inngest-dev http://127.0.0.1:8288/mcp
```

Official skills:
```bash
npx skills add inngest/inngest-skills
```

Quick test prompts:
```text
List all my Inngest functions and their triggers
Send a test event to trigger my signup workflow
Monitor the latest failed run and show the error
```

**2. eBay sold/completed listings for comps**
Best fit for completed/sold price checks:
```bash
export APIFY_TOKEN='YOUR_APIFY_TOKEN'

claude mcp add --transport http \
  --header "Authorization: Bearer $APIFY_TOKEN" \
  ebay-sold \
  "https://mcp.apify.com/?tools=caffein.dev/ebay-sold-listings"
```

Quick test prompts:
```text
Search sold eBay listings for "Pokemon Crystal CIB" and summarize median sale price
Find sold comps for "Sony PSP 3000" in the last 90 days
```

**3. eBay seller-side APIs**
This is the broader eBay API server. I’m translating its README JSON config into Claude Code’s `claude mcp add` form.

Minimum setup:
```bash
claude mcp add --transport stdio \
  --env EBAY_CLIENT_ID=YOUR_EBAY_CLIENT_ID \
  --env EBAY_CLIENT_SECRET=YOUR_EBAY_CLIENT_SECRET \
  --env EBAY_ENVIRONMENT=production \
  ebay \
  -- npx -y ebay-mcp
```

Higher-rate setup with OAuth refresh token:
```bash
claude mcp add --transport stdio \
  --env EBAY_CLIENT_ID=YOUR_EBAY_CLIENT_ID \
  --env EBAY_CLIENT_SECRET=YOUR_EBAY_CLIENT_SECRET \
  --env EBAY_ENVIRONMENT=production \
  --env EBAY_USER_REFRESH_TOKEN=YOUR_EBAY_USER_REFRESH_TOKEN \
  ebay \
  -- npx -y ebay-mcp
```

Quick test prompts:
```text
Show my active eBay listings
Check my seller analytics for the last 30 days
List recent orders and fulfillment status
```

**4. SerpApi**
Official hosted MCP:
```bash
claude mcp add --transport http \
  serpapi \
  "https://mcp.serpapi.com/YOUR_SERPAPI_API_KEY/mcp"
```

Quick test prompts:
```text
Search Google for "best mechanical keyboard 2026" and return compact results
Run an eBay engine search for "Nintendo DS Lite" and summarize listing prices
```

**Recommended final stack**
- `inngest-dev` + `inngest-skills`
- `ebay-sold` for sold/completed comps
- `ebay` for authenticated seller APIs
- `serpapi` for broader search and extra eBay-engine lookups

**Sources**
- Claude Code MCP setup docs: [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp)
- Inngest MCP: [inngest.com/docs/ai-dev-tools/mcp](https://www.inngest.com/docs/ai-dev-tools/mcp)
- Inngest skills: [inngest.com/docs/ai-dev-tools/agent-skills](https://www.inngest.com/docs/ai-dev-tools/agent-skills)
- SerpApi MCP: [github.com/serpapi/serpapi-mcp](https://github.com/serpapi/serpapi-mcp)
- eBay sold comps via Apify MCP: [apify.com/caffein.dev/ebay-sold-listings/api/mcp](https://apify.com/caffein.dev/ebay-sold-listings/api/mcp)
- eBay seller MCP: [github.com/YosefHayim/ebay-mcp](https://github.com/YosefHayim/ebay-mcp)
- eBay Browse API: [developer.ebay.com/api-docs/buy/static/api-browse.html](https://developer.ebay.com/api-docs/buy/static/api-browse.html)
- eBay note on Marketplace Insights restriction: [developer.ebay.com/api-docs/buy/static/ref-buy-browse-filters.html](https://developer.ebay.com/api-docs/buy/static/ref-buy-browse-filters.html)

