# AI Listings — Master Plan

This is the navigation hub for the entire implementation. Each sub-plan is a self-contained implementation document. Work through them in order.

---

## What This Builds

A personal resale listing platform where you drop one photo per item and an AI pipeline handles product identification, image processing, pricing research, and draft listing generation. An AI agent manages each listing through iterative chat. When ready, you copy fields to eBay or Poshmark.

**One photo → one listing → automated pipeline → agent chat → copy-paste to eBay/Poshmark.**

Designed for 30–40 items in progress simultaneously. The agent is proactive — it works without asking permission and only surfaces decisions when genuinely blocked.

---

## Reference Documents

These are the source-of-truth documents. Read them when a sub-plan references "the spec" or "the PRD."

| Document | What it is |
|----------|-----------|
| `docs/superpowers/specs/design-spec.md` | Full system design — data model, pipeline steps, agent system, UI layout, SKU system |
| `docs/superpowers/specs/prd.md` | PRD — architecture diagrams, wireframes, credentials table, open questions |
| `docs/thick-tools-pattern.md` | Agent tool design guide — thick tools pattern, TypeScript interfaces |
| `docs/gap-mcp-skills-recs.md` | MCP setup commands for Inngest, eBay, SerpAPI, Apify |
| `CLAUDE.md` | Project-level Claude Code config — which skills to activate, MCP servers, agent behavior rules |

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend + API | Next.js 15 (App Router) on Vercel |
| Database + Auth + Storage + Realtime | Supabase (PostgreSQL) — dedicated project |
| Background pipelines | Inngest — durable, per-step retry, fan-out |
| Product ID | SerpAPI (Google Lens) |
| Image processing | PhotoRoom API |
| AI model | Claude (Anthropic) — vision + agent + generation |
| Pricing comps | Apify eBay Sold Listings + SerpAPI cross-platform |

---

## Sub-Plans

Work through these in order. Each one ends at a runnable, smoke-testable state.

### Sub-plan 1 — Project Scaffold ← YOU ARE HERE
**Plan:** `docs/superpowers/plans/01-scaffold.md`
**Beads task:** `ai-listings-scaffold`

Builds: Next.js project init, Supabase schema (all 4 tables + SKU system + RLS + Realtime), Inngest client + skeleton pipeline function, app shell with placeholder pages, smoke test confirming end-to-end event flow.

**Done when:** You can drop a `photo/uploaded` event in the Inngest dev console and see a listing flip to `in_loop` in the database.

---

### Sub-plan 2 — Intake Pipeline
**Plan:** `docs/superpowers/plans/02-intake-pipeline.md` *(not yet written)*
**Beads task:** `ai-listings-intake-pipeline`

Builds: Full Inngest workflow — Step 1 (Google Lens / SerpAPI), Step 2 (Claude vision + photo plan), ID verification gate (pause pipeline, surface confirmation card), Step 3 (eBay Apify comps + SerpAPI cross-platform pricing), Step 4a (Claude draft listing) + Step 4b (PhotoRoom image processing, parallel), Step 5 (Claude auth plan, luxury only), photo quality gate (studio uploads), retry-step handler, Supabase Realtime pushes at each step, pipeline failure badge logic.

**Done when:** Uploading a real photo runs through all 5 steps, generates a draft listing with pricing comps, and the dashboard card updates live via Realtime.

---

### Sub-plan 3 — Agent System
**Plan:** `docs/superpowers/plans/03-agent-system.md` *(not yet written)*
**Beads task:** `ai-listings-agent-system`

Builds: `skills/agent-skills.md` flat file (all brand/category knowledge), system prompt in `lib/agent/system-prompt.ts`, context assembly with cache-stable prefix, all 6 thick agent tools (`research_pricing`, `get_auth_checklist`, `build_description`, `update_listing`, `get_listing_summary`, `get_photo_plan`), streaming agent chat API route, mcp-exec integration for data-heavy pricing aggregation.

**Done when:** You can open the agent chat for an `in_loop` listing, ask "what should I price this at?", and get a streaming response with real comp data.

---

### Sub-plan 4 — Dashboard + Workspace UI
**Plan:** `docs/superpowers/plans/04-ui.md` *(not yet written)*
**Beads task:** `ai-listings-ui`

Builds: Dashboard — listing card grid, status badges (priority order), "cooking" spinner state, drag-and-drop upload zone (N photos → N listings → N cards appear), Supabase Realtime subscriptions driving live card updates, toast notification queue. Listing workspace — split layout (left: photos + photo plan + inclusions + fields; right: agent chat), photo grid with drag-to-reorder, pricing evidence drawer, auth checklist progress, failed step warning + retry button.

**Done when:** Dropping 3 photos on the dashboard creates 3 cards that animate in and update live as the pipeline runs.

---

### Sub-plan 5 — Publish Export
**Plan:** `docs/superpowers/plans/05-publish-export.md` *(not yet written)*
**Beads task:** `ai-listings-publish-export`

Builds: Platform tabs (eBay · Poshmark) populated from `platform_fields` JSONB, per-field Copy buttons, Copy All button, listing URL input (saves to `listing_urls`), SEO audit checklist at finalization (keyword density, description length, category specificity, item specifics completeness), status transition to `finalizing` → `published`.

**Done when:** You can open a `finalizing` listing, switch to eBay tab, copy all fields, paste a listing URL, and see the listing transition to `published`.

---

## How to Use This Plan

**Starting a sub-plan:**
```
Read docs/MASTER-PLAN.md and docs/superpowers/plans/0N-<name>.md.
Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement the plan.
```

**Moving to the next sub-plan:**
```
The previous sub-plan is complete. Read docs/MASTER-PLAN.md to find the next sub-plan.
Use superpowers:writing-plans to write docs/superpowers/plans/0N-<name>.md, then execute it.
```

**If context is lost:**
Read `docs/MASTER-PLAN.md` first — it has everything needed to reorient.
Then read the specific sub-plan you're on and the reference docs it cites.

---

## Credentials Checklist

Gather these before running sub-plan 2 (intake pipeline needs them all):

- [ ] `ANTHROPIC_API_KEY` — console.anthropic.com (separate from Claude Code subscription)
- [ ] `SERPAPI_API_KEY` — serpapi.com
- [ ] `APIFY_TOKEN` — apify.com
- [ ] `EBAY_CLIENT_ID` + `EBAY_CLIENT_SECRET` — developer.ebay.com
- [ ] `PHOTOROOM_API_KEY` — photoroom.com/api
- [ ] `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` — dedicated Supabase project
- [ ] `INNGEST_SIGNING_KEY` + `INNGEST_EVENT_KEY` — app.inngest.com

See `docs/superpowers/specs/prd.md` → Required Credentials section for full notes.

---

## Open Questions (resolve before or during implementation)

From `docs/superpowers/specs/prd.md`:

1. **Inngest account** — existing account? Retrieve keys from app.inngest.com.
2. **Apify pricing** — run a test search, check compute unit cost per run (~$0.002–$0.005 expected).
3. **eBay completed listings** — confirm Apify actor returns *sold* prices (not just active listings).
4. **PhotoRoom plan** — check current pricing tiers before go-live.
5. **ID gate — auto-approve threshold?** Always gate, or auto-approve if confidence ≥ 95%?
6. **Condition notes auto-draft** — agent proposes draft from studio photos (~$0.01–$0.02/listing). Acceptable cost?
7. **Skills file editing** — plain file editing acceptable for Phase 1, or need in-app editor?
8. **Supabase Realtime at scale** — confirm plan supports 30–40 concurrent active listings.
9. **eBay Authenticity Guarantee threshold** — verify current minimum (expected $500, may vary by category).
10. **SerpAPI plan** — confirm Google Lens engine calls are included in current plan.
