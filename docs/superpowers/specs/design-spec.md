# AI Listings Platform — Design Spec

**Date:** 2026-04-22
**Phase:** 1 — Intake + Listing Creation + AI Agent
**Status:** Approved

---

## Overview

A personal web platform for creating and iterating on resale listings. The primary interface is an AI agent. The user photographs one item per shot, uploads the photos, and the system identifies each product, processes images, researches pricing, and generates draft listings automatically — one listing per photo. The user iterates with the agent until a listing is ready, then copies fields to eBay or Poshmark.

**Guiding principle:** Automate everything that doesn't require human judgment. Surface the agent for everything that does.

---

## Scope — Phase 1

In scope:

- Photo intake pipeline (one photo → one listing → product ID → image processing → draft)
- Photo plan generation (item-specific shot checklist for the studio session)
- AI agent chat per listing (conversational iteration, research, auth planning)
- Listing workspace (fields, photos, pricing evidence, auth checklist, inclusions)
- Dashboard (inventory overview, status at a glance, agent-blocked alerts)
- Publish export mode (per-platform copy-paste fields)

Out of scope (Phase 2+):

- eBay / Poshmark API publishing (sync)
- Self-promotion automation
- Multi-user / team support
- Collectibles category (Tokidoki, etc.) — see Roadmap

---

## Tech Stack

| Layer | Choice | Rationale |
| --- | --- | --- |
| Frontend | Next.js (App Router) | Full-stack JS, Vercel-native |
| Database | Supabase (PostgreSQL) | Auth, storage, realtime built-in — **dedicated project, not shared** |
| File storage | Supabase Storage | Photos (raw + processed) |
| Background workflows | Inngest | Durable multi-step pipelines, per-step retry, fan-out |
| Deployment | Vercel | Native Inngest integration |
| Product ID | SerpAPI (Google Lens) | Richest product matches |
| Image processing | PhotoRoom API | Best-in-class product photo staging for resale |
| AI model | Claude (Anthropic) | Vision + agent + listing generation |
| Pricing — sold comps | Apify eBay Sold Listings MCP | Completed/sold price comps |
| Pricing — seller APIs | ebay-mcp (npx) | eBay seller-side APIs |
| Pricing — cross-platform | SerpAPI | Google Shopping, Poshmark, The RealReal comps |
| Dev workflow | mcp-exec (v0.3) | Keeps intermediate research out of context window |

> **Platform schemas:** eBay Item Specifics and Poshmark category/field schemas must be fetched from live API documentation at build time — do not rely on training data, both change frequently.

### MCP / Plugin Coverage

| Tool | Plugin | MCP setup | Skills |
| --- | --- | --- | --- |
| Vercel | ✅ `vercel-plugin` | ✅ `vercel-plugin_vercel__authenticate` | `vercel-plugin:nextjs`, `vercel-plugin:ai-sdk`, etc. |
| Supabase | ✅ `supabase` | ✅ `supabase_supabase__authenticate` | `supabase:supabase-postgres-best-practices` |
| Next.js | via Vercel plugin | — | `vercel-plugin:nextjs`, `vercel-plugin:react-best-practices` |
| Inngest | — | Local dev CLI MCP (see `docs/gap-mcp-skills-recs.md`) | `npx skills add inngest/inngest-skills` |
| eBay sold comps | — | Apify hosted MCP (see `docs/gap-mcp-skills-recs.md`) | — |
| eBay seller APIs | — | `npx -y ebay-mcp` stdio MCP (see `docs/gap-mcp-skills-recs.md`) | — |
| SerpAPI | — | Official hosted MCP (see `docs/gap-mcp-skills-recs.md`) | — |
| mcp-exec | ✅ installed | ✅ active | `docs/thick-tools-pattern.md` in this repo |

---

## Listing Lifecycle

Each uploaded photo becomes one independent listing. A listing remains in the iterative loop until explicitly finalized.

```text
Intake → InLoop ⟷ (agent works · user reviews) → Finalizing → Published → Archived
                                                                    ↓
                                                              (re-open → InLoop)
```

States:

- `intake` — pipeline running; listing card shows "processing" state, not yet interactive
- `in_loop` — pipeline complete; agent ready, user can chat and edit; multiple work threads may be active simultaneously (pricing, image processing, auth checklist)
- `finalizing` — user has flagged ready; SEO audit + export fields generated
- `published` — copied to platform; URL tracked
- `archived` — sold or removed

---

## SKU System

Every listing is assigned a human-writable SKU at creation:

**Format:** `{CATEGORY_PREFIX}-{ZERO_PADDED_SEQUENCE}`

| Category | Prefix | Example |
| --- | --- | --- |
| Handbag | HB | HB-0042 |
| Clothing | CL | CL-0103 |
| Sneakers | SN | SN-0017 |
| Electronics | EL | EL-0007 |
| Jewelry | JW | JW-0005 |
| Collectibles | CO | CO-0012 (Phase 2) |
| Other | OT | OT-0201 |

SKU is printed on a sticker and applied to the physical item's container for warehouse-style organization.

---

## Intake Pipeline (Inngest Workflow)

Each photo upload creates one listing record (SKU assigned at creation) and fires one `photo/uploaded` event. Multiple photos uploaded at once each create their own listing and run through the pipeline in parallel — they are independent items.

The intake photo is for identification only. A photo plan is generated immediately for the studio session. The full studio photos are uploaded later.

### Cost estimates per item

| Step | Service | Estimated cost |
| --- | --- | --- |
| Step 1 | SerpAPI (Google Lens) | ~$0.01/search |
| Step 2 | Claude Vision (Sonnet) | ~$0.01–$0.02 (image tokens + analysis output) |
| Step 2b | Claude (photo plan, combined with Step 2) | $0 if batched into Step 2 call |
| Step 3 | Pricing — eBay sold comps (Apify MCP) | ~$0.005–$0.01/search |
| Step 3 | Pricing — SerpAPI cross-platform | ~$0.01–$0.03 (1–3 searches for luxury items) |
| Step 4 | Claude (draft listing, text-only) | ~$0.02–$0.03 |
| Step 4 | PhotoRoom | ~$0.08–$0.10/image |
| Step 5 | Claude (auth plan, conditional) | ~$0.02 if triggered |
| **Total — non-luxury item** | | **~$0.13–$0.18** |
| **Total — luxury item** | | **~$0.15–$0.21** |

> Google Lens via SerpAPI provides product URLs, brand, and model. For well-known products with strong matches, the vision analysis in Step 2 may confirm rather than add new information. At ~$0.01–0.02, run it anyway — it provides condition assessment and feature extraction that Lens cannot, and the cost is negligible relative to PhotoRoom. Combine Steps 2 and 2b into a single Claude call.

### Steps (each retries independently on failure)

#### Step 1 — Product ID (SerpAPI / Google Lens)

- Submit photo to Google Lens via SerpAPI
- Extract: product title, brand, category, product page URLs, visual matches
- Store raw result in `listings.intake_meta`

#### Step 2 + 2b — Vision analysis + photo plan (Claude, single call)

- Send photo + Lens results to Claude vision
- Extract: brand confirmation, condition assessment, notable features, category classification, inclusions visible in photo (e.g., box, dust bag, auth card visible alongside the item)
- Determine if luxury brand → flag for authentication plan
  - Cross-reference against configurable luxury brands list in app config (Chanel, Louis Vuitton, Hermès, Gucci, Prada, Balenciaga, Christian Louboutin, Nike/Jordan for sneakers). The list is the override; Claude's judgment handles unlisted brands.
- **In the same call:** generate the photo plan — an item-specific shot checklist for the studio session

Photo plan examples by category:

- **Handbag:** front flat, back flat, bottom, interior open, all hardware close-up, brand stamp, date code, auth card, serial number, strap, zipper pulls, any damage areas
- **Sneakers:** side profile (both), toe box, heel, insole, box label, hangtag, any creasing or scuffs
- **Electronics:** front powered off, front powered on showing boot/home screen, back, ports close-up, serial/IMEI label, all included accessories, any damage areas
- **Clothing:** front flat, back flat, brand tag, care label, measurement reference, any wear/damage areas

Photo plan stored in `listings.photo_plan`: `[{ shot, description, required, photo_type }]`

#### Step 3 — Pricing research (eBay Apify MCP + SerpAPI)

- Query eBay sold/completed listings via Apify eBay Sold Listings MCP: last 90 days, same brand/model
- For luxury/designer items: query SerpAPI for cross-platform comps (Poshmark, The RealReal, Google Shopping)
- Store each comp as a `pricing_comps` row (source, title, price, condition, sold date, URL)
- Calculate confidence score (0–100): more comps = higher; older sales = lower; condition mismatch = lower

#### Step 4 — Draft listing + image processing (Claude + PhotoRoom, in parallel)

These run concurrently since they're independent.

**Draft (Claude + agent skill):**

- Inject `skills/agent-skills.md` as context
- Generate canonical title, description, condition statement, suggested price
- Canonical title: brand + model + key attributes, not platform-specific
- Platform-specific titles (eBay 80-char keyword-optimized, Poshmark) generated and stored in `platform_fields`
- Suggested price derived from comp analysis with condition adjustment

**Image processing (PhotoRoom):**

- Remove background, auto-crop, auto-rotate, stage on white
- Store processed image in Supabase Storage
- Store PhotoRoom metadata in `photos.photoroom_meta`

#### Step 5 — Authentication plan (conditional, luxury items only)

- Claude generates item-specific authentication checklist using the brand section of `skills/agent-skills.md`
- Stored as JSONB array in `listings.auth_plan`: `[{ step, guidance, status, photo_required }]`
- Checklist steps are evidence-based (e.g., Chanel: photograph auth card → look up serial number → verify era matches item style and hardware)
- **For items ≥ $500:** note that eBay Authenticity Guarantee and Poshmark Posh Authenticate handle authentication as part of the sale — no third-party service needed, platform bears the cost
- **For items < $500:** self-authenticate using the checklist; platforms may not offer authentication at this price point

After all steps: listing status → `in_loop`, Supabase Realtime pushes update to dashboard.

### Pipeline failure handling

Each Inngest step retries up to 3 times with exponential backoff + jitter. After 3 failures:

- Listing card on dashboard shows a warning badge: "step failed — [step name]"
- Listing enters `in_loop` with whatever steps completed (partial completion is valid)
- Agent notes what's missing: "Pricing research failed — I can retry it if you'd like"
- "Retry step" button in the listing workspace re-fires the specific failed step via a new Inngest event
- PhotoRoom failures fall back to the raw intake photo; user is notified and can re-trigger

---

## Data Model

### `listings`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `sku` | text | HB-0042 format, unique |
| `status` | text | intake \| in_loop \| finalizing \| published \| archived |
| `title` | text | Canonical title — brand + model + key attributes |
| `description` | text | Canonical description |
| `category` | text | handbag \| clothing \| sneakers \| electronics \| jewelry \| other |
| `brand` | text | |
| `condition` | text | See Condition Values below |
| `suggested_price_cents` | integer | |
| `final_price_cents` | integer | User-confirmed price |
| `confidence_score` | integer | 0–100 |
| `inclusions` | jsonb | `[{ item, included, notes }]` — what comes with the item |
| `auth_plan` | jsonb | `[{ step, guidance, status, photo_required }]` |
| `photo_plan` | jsonb | `[{ shot, description, required, photo_type }]` |
| `platform_fields` | jsonb | `{ ebay: { title, category_id, item_specifics, ... }, poshmark: { ... } }` |
| `ebay_listing_url` | text | Tracked after publish |
| `poshmark_listing_url` | text | Tracked after publish |
| `intake_meta` | jsonb | Raw SerpAPI + Claude vision output |
| `is_luxury` | boolean | Drives auth plan generation |
| `agent_blocked` | boolean | True when agent has an unanswered question; drives dashboard notification |
| `agent_blocked_reason` | text | Short description of what the agent is waiting on |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### Condition Values

The condition field uses an 8-level scale that maps cleanly to both eBay and Poshmark schemas:

| Value | Display | Maps to eBay | Maps to Poshmark |
| --- | --- | --- | --- |
| `new_with_tags` | New with Tags | New | NWT |
| `new_without_tags` | New without Tags | New without tags | NWOT |
| `like_new` | Like New | Used — Like New | Excellent |
| `very_good` | Very Good | Used — Very Good | Good |
| `good` | Good | Used — Good | Good |
| `fair` | Fair | Used — Acceptable | Fair |
| `poor` | Poor | Used — For parts | Poor |
| `for_parts` | For Parts/Not Working | For parts or not working | — |

The agent prompts for condition during intake and explains what each level means in context of the specific item type.

### `inclusions`

The `inclusions` JSONB field tracks everything that comes with the item. This is part of the listing and affects value. Examples:

- **Handbag:** Original box, dust bag, authentication card, eBay authentication card (if purchased with platform auth), care booklet, shoulder strap (if detachable), lock + keys
- **Electronics:** Power cable, charging brick, USB cable, HDMI cable, adapters, original packaging, warranty card, manuals
- **Sneakers:** Original box, both lace sets, hangtag, receipt/proof of purchase, extra insoles

### `photos`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `listing_id` | uuid FK | |
| `type` | text | intake \| processed \| auth_card \| studio |
| `raw_url` | text | Supabase Storage URL |
| `processed_url` | text | PhotoRoom output URL |
| `display_order` | integer | User-controlled sort order |
| `photoroom_meta` | jsonb | Crop bounds, rotation, bg removal details |
| `created_at` | timestamptz | |

### `pricing_comps`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `listing_id` | uuid FK | |
| `source` | text | ebay \| poshmark \| therealreal \| google |
| `title` | text | Comp listing title |
| `sale_price_cents` | integer | |
| `condition` | text | Actual condition label from source (e.g., "Pre-owned – Good") |
| `sold_at` | date | |
| `listing_url` | text | |
| `condition_delta` | text | same \| better \| worse — relative to this listing's condition |
| `adjusted_price_cents` | integer | Price adjusted for condition delta |
| `created_at` | timestamptz | |

### `conversations`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `listing_id` | uuid FK | |
| `role` | text | user \| assistant |
| `content` | text | |
| `context_snapshot` | jsonb | Skill content hash + listing snapshot at send time (for auditability) |
| `created_at` | timestamptz | |

---

## Agent System

### Agent skills — flat file

All brand and category knowledge lives in a single file: `skills/agent-skills.md`. No database table. The file is loaded in full at session start as a cache-stable prefix — never per-turn, never partial.

The file is structured in sections by category, with brand subsections:

```text
skills/agent-skills.md
  ## Handbags (general)
  ## Chanel
  ## Louis Vuitton
  ## Christian Louboutin
  ## Sneakers (general)
  ## Nike / Jordan
  ## Electronics (general)
  ## Clothing (general)
  ## Luxury (general fallback)
```

Key knowledge per brand/category:

| Section | Key knowledge |
| --- | --- |
| Handbags (general) | Auth signals, hardware check, date codes, dust bags, receipts, strap condition, lining |
| Chanel | Auth card serial → era lookup (12–14 digits, year ranges documented), hologram sticker placement, quilting pattern by year, CC logo alignment, hardware stamping |
| Louis Vuitton | Date code format (letter + number series by factory/year), canvas condition grading, hardware, receipt/dustbag, made-in label |
| Christian Louboutin | Red sole condition (key value driver), Loubi code on insole (post-2011), leather grain quality, heel height accuracy, box + dustbag |
| Sneakers (general) | DS vs worn, box label verification, toe box shape, manufacturing tags, insole, creasing assessment |
| Nike / Jordan | Year-correct colorways, legit-check specifics by model, heel tab shape, insole tags, factory code |
| Electronics (general) | Functional test checklist, IMEI/serial verification, cosmetic grading scale, accessory completeness |
| Clothing (general) | Measurement guide, fabric/label check, wash wear grading, sizing notes by brand |
| Luxury (general fallback) | Generic auth signals, condition grading, how to assess inclusions value; **no referrals to Entrupy or Real Authentication** — use eBay Authenticity Guarantee (≥$500) or Poshmark Posh Authenticate (≥$500) as the authentication layer for high-value items |

### Context assembly (per turn)

Context is assembled in this exact order to maximize Claude's prompt caching. Cache-stable content goes first; dynamic content goes last.

```text
1. System prompt (base agent identity) — cache anchor, never changes
2. skills/agent-skills.md (full file) — loaded at session start, never changes mid-session
3. Listing snapshot (current field values) — changes infrequently, cache-friendly
4. Conversation history (sliding window, ~8k token budget) — append-only
5. Tool result (this turn only — pre-aggregated, not raw)
```

**Context window budget:** Target ≤ 75% full at all times. Oldest conversation turns dropped first when approaching limit. System prompt, skills, and listing snapshot are never dropped. mcp-exec `exec()` calls keep intermediate tool data out of context entirely.

### Thick agent tools

All tools aggregate server-side and return typed structured objects. Raw API responses never enter Claude's context. Pattern and TypeScript interface conventions from `docs/thick-tools-pattern.md`.

#### `research_pricing(listingId)`

Agent question: *"What should I price this at?"*

Server-side: query `pricing_comps` + run eBay sold search via Apify MCP + condition analysis + weighted median calculation. For data-heavy aggregation (large comp sets, statistical outlier removal), use mcp-exec Python runtime with pandas/numpy.

```typescript
interface PricingResearch {
  ok: true;
  suggestedPrice: number;        // cents
  confidence: number;            // 0–100
  confidenceSummary: string;     // "8 comps · mostly recent · condition match good"
  comps: Array<{
    source: string;              // "ebay" | "poshmark" | "therealreal"
    title: string;
    price: number;               // cents, actual sold price
    condition: string;           // actual label from source
    conditionDelta: string;      // "same" | "better" | "worse"
    adjustedPrice: number;       // cents, adjusted for condition delta
    soldDaysAgo: number;         // relative — not absolute date
    url: string;
  }>;
  evidence: string;              // e.g. "Median of 8 sold comps, good condition, adjusted +$40 for your like_new"
}

type PricingResearchResult = PricingResearch | { ok: false; reason: string };
```

#### `get_auth_checklist(listingId)`

Agent question: *"What's left for authentication?"*

Server-side: read `auth_plan`, enrich steps with relevant guidance from `skills/agent-skills.md`.

```typescript
interface AuthChecklist {
  ok: true;
  passed: boolean;
  confidence: 'high' | 'medium' | 'low';
  steps: Array<{
    step: string;
    guidance: string;
    status: 'pending' | 'done' | 'failed';
    photoRequired: boolean;
  }>;
  platformAuth: {               // platform authentication eligibility
    eligible: boolean;
    platform: 'ebay' | 'poshmark' | null;
    threshold: number;          // cents — eligible if price >= threshold
    note: string;
  };
}

type AuthChecklistResult = AuthChecklist | { ok: false; reason: string };
```

#### `build_description(listingId)`

Agent question: *"Write/improve the listing description."*

Server-side: SEO keyword research + description generation + platform-specific variants.

```typescript
interface ListingDescription {
  ok: true;
  canonical: string;
  seoKeywords: string[];
  platforms: Array<{
    platform: 'ebay' | 'poshmark';
    title: string;              // platform-specific, length-constrained
    description: string;
    characterCount: number;
  }>;
}

type ListingDescriptionResult = ListingDescription | { ok: false; reason: string };
```

#### `update_listing(listingId, fields)`

Server-side: validate fields, write to Supabase, trigger Realtime push to UI. Returns diff only.

#### `get_listing_summary(listingId)`

Returns: all listing fields + photo count + conversation turn count + inclusions + photo plan status. ~300 tokens.

#### `get_photo_plan(listingId)`

Returns: shot list with status per shot. ~100 tokens.

### Pricing evidence display

Every comp displayed with:

- **Relative date** ("3 months ago", "12 days ago") — not absolute dates
- Source platform with link
- **Actual condition label** from the source (e.g., "Pre-owned – Good"), plus relative delta (same / better / worse) and dollar adjustment (e.g., "+$40 adjusted for your 'like new'")
- Adjusted price with delta explanation
- Confidence score (0–100) with plain-English breakdown

---

## UI

### Dashboard

- Grid of listing cards: processed photo (or intake photo if studio not done), SKU, truncated title, suggested price, status badge
- **"Cooking" state:** listings in `intake` show a spinner and muted card; no click-through until pipeline completes; transitions to interactive via Supabase Realtime
- **Status badges** (most urgent shown, one at a time):
  - `processing` — pipeline running, not ready
  - `agent needs you` — agent blocked, has a question; red/orange accent draws attention
  - `needs auth photos` — auth checklist has pending photo steps
  - `pricing research` — pricing step running
  - `step failed` — pipeline step hit max retries; badge names the step
  - `ready to publish` — listing is in finalizing state
- Upload button → drag-and-drop photo intake; each photo = one listing

### Listing Workspace (split layout)

**Left panel:**

- Photo grid — main photo large, thumbnails below; drag to reorder; type labels (intake / processed / auth card / studio)
- Photo plan checklist — shots listed, user ticks off as uploaded
- Inclusions section — checklist of what comes with the item, editable
- Fields: canonical title (editable), condition (dropdown), suggested price + confidence + "view evidence" link, auth checklist progress
- Failed pipeline step warning + "Retry" button

**Right panel — agent chat:**

- Streaming responses
- Tool calls shown inline: `⚡ Researching pricing...`
- Full conversation history (scrollable)
- Input always visible at bottom
- When `agent_blocked`: agent's question shown as highlighted prompt at top of chat

**Evidence drawer** (opens from "view evidence"):

- Full comp table: source, relative date, actual condition label, price, adjusted price, condition delta explanation, link
- Confidence score breakdown

### Publish Export

- Platform tabs: eBay · Poshmark (schemas fetched from live API docs at build time)
- Each tab shows platform-specific fields from `platform_fields`, pre-populated
- Individual "Copy" per field; "Copy all" for structured block
- Listing URL field (manually entered after publishing) → stored in `ebay_listing_url` / `poshmark_listing_url`

### SEO

- Canonical title and platform titles generated with keyword research (brand + model + key attributes + condition terms buyers use)
- eBay platform title respects 80-char limit with keyword priority
- At finalization: SEO checklist — keyword density, description length, category specificity, item specifics completeness

---

## Visual Reference

> When generating the PRD, embed:
> 1. The listing lifecycle state machine diagram (Mermaid stateDiagram-v2, see brainstorm session)
> 2. The system architecture flowchart (Mermaid flowchart, see brainstorm session)
> 3. UI wireframes as Excalidraw scenes (`.excalidraw` files in `docs/wireframes/`)

---

## Roadmap

### Phase 2

- eBay / Poshmark API sync (auto-publish)
- Self-promotion automation using stored listing URLs
- Mercari as third platform

### Phase 3 — Collectibles

- `CO` SKU prefix and `collectibles` category
- Tokidoki brand section in `skills/agent-skills.md`: Unicorno series, Donutella, Cactus Friends — wave/series identification, chase vs. standard, collaboration variants (Tokidoki × Disney, etc.), condition grading for vinyl figures, box/tag completeness
- General collectibles section: limited editions, authentication, grading services (PSA/BGS for cards)

---

## Development Notes

- Supabase: create a **dedicated project** for this app — do not share with other projects
- eBay and Poshmark platform field schemas must be fetched from live API docs before implementation — do not use training data:
  - eBay Item Specifics: `https://developer.ebay.com`
  - Poshmark categories/fields: `https://poshmark.com/developer` (or scrape current field list)
- Use mcp-exec during development for multi-step research (API exploration, large response handling). See `docs/thick-tools-pattern.md` for tool design guidance.
- mcp-exec Python runtime (v0.3) available for data-heavy tasks: pricing data aggregation with pandas, statistical outlier removal, bulk CSV processing
- MCP setup commands for gap services: `docs/gap-mcp-skills-recs.md`
- Add `.superpowers/` to `.gitignore`
