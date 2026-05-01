# Agent System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A streaming chat API that lets an AI agent work on a listing — pricing research, description generation, auth checklist, listing field updates — using six thick tools that aggregate server-side so Claude's context stays clean.

**Architecture:** `skills/agent-skills.md` holds all brand/category knowledge as a flat file loaded at request time. `src/lib/agent/system-prompt.ts` builds a cache-optimized system block array (three `cache_control: ephemeral` breakpoints). `src/lib/agent/tools.ts` implements all six tool functions plus Anthropic JSON schemas and a single `executeTool` dispatcher. `src/lib/agent/chat.ts` runs the agentic loop — streams Claude, executes tool calls, loops until `end_turn`, then saves the final assistant turn to the `conversations` table. `src/app/api/agent/[listingId]/route.ts` wraps the loop in a native `ReadableStream` SSE response.

**Tech Stack:** Next.js 16 App Router, `@anthropic-ai/sdk@^0.91.0` (`messages.stream()`), Supabase JS v2 (service-role client), Zod v4, Node.js `fs/promises` to read `skills/agent-skills.md`. All types already defined in `src/types/listings.ts` — no new types needed.

---

## File Map

| File | Create / Modify | Responsibility |
|------|-----------------|---------------|
| `skills/agent-skills.md` | Create | Full brand/category knowledge — loaded into system context |
| `src/lib/agent/system-prompt.ts` | Create | `SYSTEM_PROMPT` constant + `assembleContext(listingId, userMessage)` |
| `src/lib/agent/tools.ts` | Create | 6 tool functions + Anthropic schemas + `executeTool` dispatcher |
| `src/lib/agent/chat.ts` | Create | `streamAgentResponse(listingId, message, emit)` — full agentic loop |
| `src/app/api/agent/[listingId]/route.ts` | Create | POST (streaming chat) + GET (conversation history) |

---

## Task 1: `skills/agent-skills.md`

**Files:**
- Create: `skills/agent-skills.md`

This file is loaded in full into the system prompt on every request. Write it as structured Markdown sections. No code changes — pure content.

- [ ] **Step 1.1: Create `skills/agent-skills.md`**

```markdown
# Agent Skills — Resale Listing Knowledge

This file is the authoritative knowledge base for brand authentication, category grading, and platform pricing. Read it in full before responding to any user message. Never recommend Entrupy, Real Authentication, or any third-party authentication service. For items ≥ $500, eBay Authenticity Guarantee and Poshmark Posh Authenticate handle authentication as part of the transaction — recommend these instead.

---

## Handbags — General

**Authentication signals (all brands):**
- Interior lining: even stitching, correct material for brand/era (leather vs. canvas vs. jacquard)
- Hardware: heavy, solid feel — hollow or lightweight hardware is a red flag; stamping should be crisp and deep
- Stitching: even stitch count per inch, consistent thread color, no skipped stitches or fraying
- Brand stamp: clear, crisp impression, correct font and spacing — blurry or shallow stamps are a red flag
- Smell: genuine leather has a characteristic smell; synthetic materials smell plastic or chemical

**Value-affecting inclusions (note all that are present):**
- Original box: +10–15% value
- Dust bag (correct brand color/material): +5–10%
- Authentication card (brand-specific): +10–20%
- Receipt or proof of purchase: +5%
- Lock + keys (if applicable): +5–10%
- Original shoulder strap (if detachable): +5%
- Care booklet: minimal value, but note it

**Condition grading for handbags:**
- Like new: no visible wear anywhere, interior clean, hardware pristine
- Very good: very light surface scratches on hardware, base feet show light wear, interior clean
- Good: moderate base wear, light hardware scratching, minor interior marks
- Fair: noticeable wear on corners/base, tarnished hardware, visible interior staining

---

## Chanel

**Authentication card serial:**
- Format: hologram sticker (card) + matching hologram sticker inside bag
- Pre-2005: 7–8 digit serial (sticker round, bright rainbow hologram)
- 2005–2021: 7-digit sticker (more uniform hologram pattern)
- 2021+: Chanel replaced serial cards with RFID cards — no sticker
- Card and interior sticker numbers must match exactly
- Verify era against known Chanel series numbering (widely documented in legit-check resources)

**Authentication checklist:**
- [ ] Auth card present and serial matches interior hologram sticker
- [ ] Quilting pattern consistent across all panels — no puckering or uneven diamonds
- [ ] CC logo alignment on closure: both C's interlock correctly (right C on top at left, left C on top at right)
- [ ] Hardware: gold/silver stamped "CHANEL" on all hardware pieces; hardware feels heavy
- [ ] Lining: correct material for era (burgundy leather, jersey, canvas — era-specific)
- [ ] Stitching: even and consistent, correct thread color for interior material

**Pricing notes:**
- Classic Flap: most stable resale value, strong demand
- WOC (Wallet on Chain): high liquidity
- Boy Bag: strong but more condition-sensitive than Classic Flap
- Caviar leather: more durable, typically commands premium over lambskin for worn condition

---

## Louis Vuitton

**Date code format:**
- Pre-1982: no date code
- 1982–1989: 3–6 letters indicating country + month/year (e.g., VI8906 = France, June 1989)
- 1990–2006: 2 letters (factory) + 4 digits (month/year encoded as week of month + year interleaved)
- 2007–2021: same format, factory letters changed
- 2021+: LV replaced date codes with RFID chips embedded in lining

**Date code location by item:**
- Speedy/Keepall: inside zippered interior pocket on leather tab
- Neverfull: on interior side wall on leather tab
- Wallet: inside, often on card slot

**Authentication checklist:**
- [ ] Date code present and format matches production era
- [ ] Monogram canvas: LV logos never cut at seams — always whole logos at edges
- [ ] Canvas printing: aligned, no blurring or color bleeding
- [ ] Hardware: solid brass, screws point to 12 o'clock position (not random)
- [ ] Zipper pull: branded YKK or Éclair zipper on most models
- [ ] Interior stamp: "Louis Vuitton Paris / Made in France" (or Italy, USA, Spain per factory)
- [ ] Dust bag: beige/tan canvas with brown "Louis Vuitton" lettering, drawstring closure

**Pricing notes:**
- Neverfull MM: highest-volume LV resale item, strong and consistent pricing
- Speedy 25/30: high demand, very liquid
- Monogram canvas holds value better than Damier Ebene for worn condition
- Date code legibility affects buyer confidence significantly

---

## Christian Louboutin

**Red sole — the primary value driver:**
- Grading scale (critical — document carefully):
  - Factory new: fully lacquered, zero wear
  - Like new: light scuffing on toe only, lacquer intact
  - Very good: light toe + minimal heel wear, lacquer mostly intact
  - Good: moderate wear throughout, lacquer visible but worn
  - Fair: heavy wear, most lacquer gone, bare leather showing at contact points
  - Poor: fully worn through, rubber or leather showing everywhere
- Red sole condition directly determines price tier — be specific, buyers cannot unsee it

**Loubi insole code (post-2011):**
- Inside insole, usually near arch: stamped code with size, factory, and year info
- Pre-2011 styles lack this code — not a red flag, era-specific

**Authentication checklist:**
- [ ] Red sole condition graded accurately (use scale above)
- [ ] Heel height measured — authentic heels match stated height within 3mm
- [ ] Leather quality: soft, buttery grain; toe box holds shape without stuffing
- [ ] Insole code present if post-2011 production
- [ ] Box: orange with black ribbon (authentic orange is a specific PMS color — not bright orange)
- [ ] Dust bag: rust/burnt orange cloth bag

**Common models and pricing:**
- So Kate 120mm: very high demand, price-sensitive to red sole condition
- Pigalle 120mm: similar demand to So Kate
- No heel pumps (Iriza, etc.): lower demand than stilettos
- Men's models (Louis Flat, etc.): smaller market but dedicated buyers

---

## Gucci

**Authentication checklist:**
- [ ] Serial number card: beige card with "GUCCI" in gold, serial number inside — format varies by era
- [ ] Interior stamp: "Gucci / Made in Italy" — font is specific (check against reference)
- [ ] Hardware: gold-toned hardware stamped "GUCCI" on all pieces
- [ ] Canvas pattern (GG Monogram): aligned and uncut at seams
- [ ] Lining: fabric quality and brand logo lining should match era
- [ ] Dust bag: white cotton with "GUCCI" in gold or green lettering (era-specific)

**Pricing notes:**
- GG Marmont: very strong resale, consistent demand
- Dionysus: high demand, especially smaller sizes
- Soho Disco: good liquidity
- Ophidia: growing demand, GG Supreme canvas stable

---

## Hermès

**Note:** Authentic Hermès items at resale prices are typically ≥ $1,000 (Birkin/Kelly often $5,000–$30,000+). eBay Authenticity Guarantee and Poshmark Posh Authenticate both cover items at these price points — always note this.

**Authentication checklist:**
- [ ] Blind stamp: year letter stamped inside (A=1997, B=1998... Z=2021, then A again) — look inside flap, near handles, or on interior tab
- [ ] Craftsman stamp: some bags have craftsman number
- [ ] Hardware: palladium or gold plated — engraved "Hermès Paris" on closure hardware
- [ ] Lock + keys: serial numbered lock; keys should work the lock
- [ ] Dust bag: orange felt/flannel; box is orange with brown ribbon
- [ ] Stitching: saddle stitching with linen thread — very tight, even, done by hand

**Pricing note:** Third-party authentication for Hermès is typically mandatory for buyers at this price point. Recommend eBay Authenticity Guarantee or consignment via The RealReal.

---

## Sneakers — General

**DS (deadstock) definition:**
- Unworn, in original box with all original tags/accessories; box must be undamaged
- Any sole yellowing = NOT DS, regardless of seller claim
- Any crease at toe box = worn, regardless of seller claim

**Box label verification:**
- Style code on box must match style code on shoe tongue tag exactly
- Size, width, colorway name must all match
- Box condition affects price (damaged box = 10–20% discount for DS)

**Condition assessment checklist:**
- [ ] Toe box: any creasing indicates worn; photograph closely
- [ ] Sole: check for yellowing (EVA midsole), dirt on outsole, wear at heel/toe
- [ ] Uppers: any scuffs, marks, or cleaning attempts
- [ ] Tongue tag: style code, size, factory — photograph for buyers
- [ ] Insole: check for imprint (indicates worn), check insole tag
- [ ] Laces: original laces vs. replacement — original increases value

**Sole yellowing:**
- Irreversible process from UV + oxidation
- Significant discount: light yellowing −10–20%, heavy yellowing −30–50%
- "Icy soles" (clear rubber) yellow fastest — check stock images for original sole color

---

## Nike / Jordan

**Colorway verification:**
- Every colorway has a unique style code (e.g., Air Jordan 1 Chicago: 555088-101)
- Box label must match shoe tag exactly — mismatched codes are a counterfeit tell
- Verify colorway is legitimate (not custom painted) against release records

**Model-specific legit-check points:**
- Air Jordan 1: heel tab shape and height, toe box height, ankle collar stitch count, swoosh shape
- Air Jordan 11: patent leather quality (no peeling on DS pairs), outsole translucency, eyelet shape
- Nike Dunk: toe box curvature, swoosh stitching, heel tab proportions
- Air Force 1: cupsole seam, perforations pattern, heel stamp font

**Insole and tongue tags:**
- Font, spacing, and stitch pattern on tongue tag are model/year specific
- Counterfeit tags often have incorrect spacing or font weight
- Insole tag should match style code on box label

**Factory codes:**
- Tongue tag includes country of manufacture and factory code
- Research factory codes for specific releases using legit-check community resources

---

## Electronics — General

**Functional testing checklist (do before listing):**
- [ ] Powers on and boots completely
- [ ] All buttons functional (volume, power, side buttons)
- [ ] Display: no dead pixels, no burn-in, no cracks
- [ ] All ports: charge port (test charging), headphone jack, USB ports
- [ ] Cameras: front and rear — test photo capture
- [ ] Speakers and microphone: test call quality
- [ ] Wireless: WiFi connects, Bluetooth pairs
- [ ] Battery health: report percentage (iOS: Settings → Battery → Battery Health; Android: varies)

**iPhone-specific critical checks:**
- iCloud lock status: CRITICAL — a locked iPhone has near-zero resale value
  - Check: Settings → [Name] → if it says "iCloud" with a lock, it's locked
  - Or: erase device and check if activation lock appears
- IMEI: Settings → General → About → IMEI; check carrier lock status at carrier website
- Find My: must be disabled before sale

**IMEI and serial verification:**
- IMEI on label (SIM tray or back) must match Settings display
- Serial on label must match Settings display
- Verify IMEI is not blacklisted (stolen) — use free IMEI check services before listing

**Cosmetic grading scale:**
- New: zero marks of any kind, original screen protector if applicable
- Like new: micro-scratches visible only under bright light/magnification
- Very good: light scratches on back, no screen scratches, no dings
- Good: visible scratches on back, possible light screen scratches, small dings
- Fair: heavy scratching, crack in body or screen, all functional

**Accessory completeness and value:**
- Original charging cable + brick: +$10–30 depending on model
- AirPods in original case: list separately or note case condition carefully
- Original box: +5–10%
- Manuals and stickers: minimal value but note for completeness

---

## Clothing — General

**Measurement guide (measure flat on clean surface):**
- Chest: armpit to armpit × 2 (measure 1 inch below armhole)
- Length: highest point of shoulder seam to bottom hem
- Sleeve: center back of collar to cuff
- Waist: across at narrowest point × 2
- Hips: across at widest point × 2
- Inseam: crotch seam to hem (pants)
- Always note: "measured flat, double for circumference"

**Fabric and label verification:**
- Care label must match claimed fabric (100% cashmere vs. blend is significant price difference)
- Vintage sizing: often 1–2 sizes smaller than modern sizing — always include measurements
- Luxury sizing: often runs large; include measurements regardless

**Condition assessment:**
- Pilling: any pilling = worn condition, regardless of how little the item was worn
- Fading: photograph under consistent lighting to reveal fading
- Wash wear: stretched cuffs/collar, fabric thinning — honest grading matters for feedback

---

## Luxury — General Fallback

Use this section for brands not covered above.

**Universal authentication signals:**
- Lining quality: smooth, even, correct material — cheap or uneven lining is a red flag
- Hardware weight and finish: luxury hardware is heavy, matte or polished, never painted over
- Stitching: consistent stitch length, no loose threads, thread color matches lining or is intentionally contrasting per design
- Brand stamp: single clean impression, correct font, correct depth — shallow or doubled stamps indicate fakes
- Serial numbers: if brand uses them, research format for the specific brand/era

**Condition grading impact on price:**
- Like new vs. Very good: 10–20% difference
- Very good vs. Good: 15–25% difference
- Good vs. Fair: 20–35% difference
- Be conservative — buyers will dock more than you expect for condition at resale

**Platform authentication for items ≥ $500:**
- eBay Authenticity Guarantee: covers handbags, sneakers, watches, jewelry ≥ $500; authentication happens after sale, buyer-protected, no cost to seller
- Poshmark Posh Authenticate: covers luxury handbags and accessories ≥ $500; Poshmark authenticates before buyer receives item
- Recommend these instead of any third-party service — platforms bear the cost and buyer risk

**Inclusions value — always note:**
- Original packaging (box, bag, tissue): +5–15%
- Dust bag: +5–10%
- Authentication card/certificate: +10–20%
- Receipt: +5%
- Lock + keys: +5–10% (for applicable items)
```

- [ ] **Step 1.2: Verify file was created**

```bash
wc -l skills/agent-skills.md
```

Expected: 250+ lines.

- [ ] **Step 1.3: Commit**

```bash
git add skills/agent-skills.md
git commit -m "feat: add agent-skills.md — brand/category knowledge for agent system prompt"
```

---

## Task 2: `src/lib/agent/system-prompt.ts`

**Files:**
- Create: `src/lib/agent/system-prompt.ts`

Exports `SYSTEM_PROMPT` (string constant) and `assembleContext(listingId, userMessage)` which returns the cache-optimized system block array + messages array for each Claude request.

- [ ] **Step 2.1: Create `src/lib/agent/system-prompt.ts`**

```typescript
import { readFile } from 'fs/promises'
import path from 'path'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

export const SYSTEM_PROMPT = `You are a proactive resale listing assistant with deep knowledge of luxury goods, sneakers, and electronics authentication and valuation.

You are operating on a single listing. The listing's current state is provided in your context immediately after these instructions. You have access to tools that let you research pricing, check authentication status, generate descriptions, update listing fields, and review the photo plan.

Work proactively — complete tasks without asking permission unless you genuinely cannot proceed. A genuine blocker is one where user input would materially change what you do (a missing photo you need to assess condition, a size you cannot infer). Do not ask clarifying questions about things you can look up with a tool.

Your expertise covers:
- Luxury brand authentication (Chanel, Louis Vuitton, Gucci, Hermès, Christian Louboutin, and others in the skills file)
- Sneaker authentication and market pricing (Nike/Jordan, Adidas, New Balance)
- Electronics condition grading and IMEI/iCloud verification
- Pricing research and condition-adjusted market analysis
- SEO-optimized listing copywriting for eBay and Poshmark

Authentication policy: For items priced at or above $500, eBay Authenticity Guarantee and Poshmark Posh Authenticate handle authentication as part of the transaction at no cost to the seller — always recommend these. Never recommend Entrupy, Real Authentication, or any other third-party authentication service.

When pricing, cite specific comparable sales from the comps. When writing descriptions, use buyer-search language. When authenticating, be specific about what to photograph and what to look for.`

interface SystemBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

interface MessageParam {
  role: 'user' | 'assistant'
  content: string
}

interface AssembledContext {
  systemBlocks: SystemBlock[]
  messages: MessageParam[]
}

function buildListingSnapshot(listing: Record<string, unknown>): string {
  const snap = {
    id: listing.id,
    sku: listing.sku,
    status: listing.status,
    brand: listing.brand,
    category: listing.category,
    condition: listing.condition,
    suggested_price_cents: listing.suggested_price_cents,
    confidence_score: listing.confidence_score,
    title: listing.title,
    description_preview: typeof listing.description === 'string'
      ? listing.description.slice(0, 200)
      : null,
    pipeline_step: listing.pipeline_step,
    pipeline_total: listing.pipeline_total,
    agent_blocked: listing.agent_blocked,
    agent_blocked_reason: listing.agent_blocked_reason,
    photo_plan_count: Array.isArray(listing.photo_plan) ? listing.photo_plan.length : 0,
    auth_plan_count: Array.isArray(listing.auth_plan) ? listing.auth_plan.length : 0,
    inclusions_count: Array.isArray(listing.inclusions) ? listing.inclusions.length : 0,
    is_luxury: listing.is_luxury,
  }
  return `## Current Listing State\n\`\`\`json\n${JSON.stringify(snap, null, 2)}\n\`\`\``
}

export async function assembleContext(
  listingId: string,
  userMessage: string
): Promise<AssembledContext> {
  const supabase = getSupabaseAdmin()

  const [skillsContent, listingResult, historyResult] = await Promise.all([
    readFile(path.join(process.cwd(), 'skills', 'agent-skills.md'), 'utf-8'),
    supabase
      .from('listings')
      .select('*')
      .eq('id', listingId)
      .single(),
    supabase
      .from('conversations')
      .select('role, content')
      .eq('listing_id', listingId)
      .order('created_at', { ascending: true })
      .limit(20),
  ])

  if (listingResult.error || !listingResult.data) {
    throw new Error(`assembleContext: listing ${listingId} not found`)
  }

  const listingSnapshot = buildListingSnapshot(listingResult.data as Record<string, unknown>)

  const systemBlocks: SystemBlock[] = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: skillsContent, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: listingSnapshot, cache_control: { type: 'ephemeral' } },
  ]

  const history: MessageParam[] = (historyResult.data ?? []).map((row) => ({
    role: row.role as 'user' | 'assistant',
    content: row.content,
  }))

  const messages: MessageParam[] = [
    ...history,
    { role: 'user', content: userMessage },
  ]

  return { systemBlocks, messages }
}
```

- [ ] **Step 2.2: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 2.3: Commit**

```bash
git add src/lib/agent/system-prompt.ts
git commit -m "feat: add agent system-prompt + assembleContext — 3-block cache-optimized context"
```

---

## Task 3: `src/lib/agent/tools.ts`

**Files:**
- Create: `src/lib/agent/tools.ts`

Six tool functions, their Anthropic JSON schemas, and a single `executeTool(name, listingId, input)` dispatcher. Return types come from `src/types/listings.ts` — import, don't redefine.

- [ ] **Step 3.1: Create `src/lib/agent/tools.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import type {
  PricingResearchResult,
  AuthChecklistResult,
  ListingDescriptionResult,
  AgentToolError,
} from '@/types/listings'

// ─── Tool: research_pricing ───────────────────────────────────────────────────

async function researchPricing(listingId: string): Promise<PricingResearchResult> {
  const supabase = getSupabaseAdmin()

  const { data: comps, error } = await supabase
    .from('pricing_comps')
    .select('source, title, sale_price_cents, condition, sold_at, listing_url, condition_delta, adjusted_price_cents')
    .eq('listing_id', listingId)
    .order('adjusted_price_cents', { ascending: true })

  if (error) return { ok: false, reason: `DB error: ${error.message}` }
  if (!comps || comps.length === 0) {
    return { ok: false, reason: 'No pricing comps found. Pipeline step 3 may not have run yet.' }
  }

  const prices = comps.map((c) => c.adjusted_price_cents).sort((a, b) => a - b)
  const mid = Math.floor(prices.length / 2)
  const suggestedPrice =
    prices.length % 2 === 0
      ? Math.round((prices[mid - 1] + prices[mid]) / 2)
      : prices[mid]

  const confidence =
    comps.length >= 10 ? 90 :
    comps.length >= 6  ? 75 :
    comps.length >= 3  ? 60 :
    comps.length >= 1  ? 40 : 20

  const now = Date.now()
  const mappedComps = comps.slice(0, 8).map((c) => ({
    source: c.source as string,
    title: c.title as string,
    price: c.sale_price_cents as number,
    condition: c.condition as string,
    conditionDelta: c.condition_delta as 'same' | 'better' | 'worse',
    adjustedPrice: c.adjusted_price_cents as number,
    soldDaysAgo: c.sold_at
      ? Math.floor((now - new Date(c.sold_at as string).getTime()) / 86_400_000)
      : 0,
    url: c.listing_url as string,
  }))

  return {
    ok: true,
    suggestedPrice,
    confidence,
    confidenceSummary: `${comps.length} comp${comps.length !== 1 ? 's' : ''} · ${confidence >= 75 ? 'high' : confidence >= 60 ? 'medium' : 'low'} confidence`,
    comps: mappedComps,
    evidence: `Median of ${comps.length} sold comps (condition-adjusted). Suggested: $${(suggestedPrice / 100).toFixed(0)}.`,
  }
}

// ─── Tool: get_auth_checklist ─────────────────────────────────────────────────

async function getAuthChecklist(listingId: string): Promise<AuthChecklistResult> {
  const supabase = getSupabaseAdmin()

  const { data: listing, error } = await supabase
    .from('listings')
    .select('auth_plan, is_luxury, suggested_price_cents')
    .eq('id', listingId)
    .single()

  if (error || !listing) return { ok: false, reason: 'Listing not found' }
  if (!listing.is_luxury) return { ok: false, reason: 'No auth plan — item is not flagged as luxury' }

  const authPlan = (listing.auth_plan as Array<{
    step: string; guidance: string; status: string; photo_required: boolean
  }>) ?? []

  if (authPlan.length === 0) return { ok: false, reason: 'Auth plan not generated yet (pipeline step 5 may not have run)' }

  const steps = authPlan.map((s) => ({
    step: s.step,
    guidance: s.guidance,
    status: s.status as 'pending' | 'done' | 'failed',
    photoRequired: s.photo_required,
  }))

  const allDone = steps.every((s) => s.status === 'done')
  const anyFailed = steps.some((s) => s.status === 'failed')
  const passed = allDone && !anyFailed

  const confidence: 'high' | 'medium' | 'low' =
    steps.filter((s) => s.status === 'done').length / steps.length > 0.8 ? 'high' :
    steps.filter((s) => s.status === 'done').length > 0 ? 'medium' : 'low'

  const priceCents = (listing.suggested_price_cents as number | null) ?? 0
  const AUTH_THRESHOLD = 50_000 // $500 in cents

  return {
    ok: true,
    passed,
    confidence,
    steps,
    platformAuth: {
      eligible: priceCents >= AUTH_THRESHOLD,
      platform: priceCents >= AUTH_THRESHOLD ? 'ebay' : null,
      threshold: AUTH_THRESHOLD,
      note: priceCents >= AUTH_THRESHOLD
        ? 'Item is ≥ $500 — eBay Authenticity Guarantee and Poshmark Posh Authenticate are available. Platform covers the cost; no third-party service needed.'
        : `Item is under $500 — self-authenticate using the checklist above. Platform authentication not available below $${(AUTH_THRESHOLD / 100).toFixed(0)}.`,
    },
  }
}

// ─── Tool: build_description ──────────────────────────────────────────────────

async function buildDescription(
  listingId: string,
  tone: string = 'casual'
): Promise<ListingDescriptionResult> {
  const supabase = getSupabaseAdmin()
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  const { data: listing, error: listingErr } = await supabase
    .from('listings')
    .select('brand, category, condition, condition_notes, tags, inclusions, suggested_price_cents, platform_fields')
    .eq('id', listingId)
    .single()

  if (listingErr || !listing) return { ok: false, reason: 'Listing not found' }

  const { data: comps } = await supabase
    .from('pricing_comps')
    .select('source, title, adjusted_price_cents, condition, condition_delta')
    .eq('listing_id', listingId)
    .order('adjusted_price_cents')
    .limit(5)

  const compsText = comps && comps.length > 0
    ? comps.map((c) =>
        `${c.source}: "${c.title}" — $${((c.adjusted_price_cents as number) / 100).toFixed(0)} adjusted (${c.condition}, ${c.condition_delta} condition)`
      ).join('\n')
    : 'No comps available'

  const inclusions = (listing.inclusions as Array<{ item: string; included: boolean }> ?? [])
    .filter((i) => i.included).map((i) => i.item).join(', ') || 'None noted'

  const priceHint = listing.suggested_price_cents
    ? `Suggested price from comps: $${((listing.suggested_price_cents as number) / 100).toFixed(0)}.`
    : 'No pricing data — suggest a fair price.'

  const prompt = `Generate a resale listing for this item. Tone: ${tone}.

Item:
- Brand: ${listing.brand}
- Category: ${listing.category}
- Condition: ${listing.condition}${listing.condition_notes ? ` — ${listing.condition_notes}` : ''}
- Key features/tags: ${(listing.tags as string[] ?? []).join(', ') || 'None noted'}
- Inclusions: ${inclusions}

Comps (sold prices):
${compsText}

${priceHint}

Use the generate_listing tool. Rules:
- canonical: factual, buyer-oriented, no filler ("don't miss out", "rare find")
- eBay title: ≤ 80 chars, keyword-rich (brand + model + key attributes buyers search)
- Poshmark title: ≤ 60 chars, natural language
- seoKeywords: top 8 search terms buyers use for this specific item`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    tools: [{
      name: 'generate_listing',
      description: 'Generate resale listing text',
      input_schema: {
        type: 'object' as const,
        properties: {
          canonical: { type: 'string', description: 'Canonical description, 2–4 sentences' },
          ebay_title: { type: 'string', description: 'eBay title, max 80 chars' },
          ebay_description: { type: 'string' },
          poshmark_title: { type: 'string', description: 'Poshmark title, max 60 chars' },
          poshmark_description: { type: 'string' },
          seo_keywords: { type: 'array', items: { type: 'string' } },
        },
        required: ['canonical', 'ebay_title', 'ebay_description', 'poshmark_title', 'poshmark_description', 'seo_keywords'],
      },
    }],
    tool_choice: { type: 'tool', name: 'generate_listing' },
    messages: [{ role: 'user', content: prompt }],
  })

  const toolUse = response.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    return { ok: false, reason: 'Claude did not return a tool_use block' }
  }

  const out = toolUse.input as {
    canonical: string; ebay_title: string; ebay_description: string
    poshmark_title: string; poshmark_description: string; seo_keywords: string[]
  }

  return {
    ok: true,
    canonical: out.canonical,
    seoKeywords: out.seo_keywords,
    platforms: [
      { platform: 'ebay', title: out.ebay_title, description: out.ebay_description, characterCount: out.ebay_title.length },
      { platform: 'poshmark', title: out.poshmark_title, description: out.poshmark_description, characterCount: out.poshmark_title.length },
    ],
  }
}

// ─── Tool: update_listing ─────────────────────────────────────────────────────

const InclusionSchema = z.object({
  item: z.string(),
  included: z.boolean(),
  notes: z.string().nullable(),
})

const AuthStepSchema = z.object({
  step: z.string(),
  guidance: z.string(),
  status: z.enum(['pending', 'done', 'failed']),
  photo_required: z.boolean(),
})

const PhotoShotSchema = z.object({
  shot: z.string(),
  description: z.string(),
  required: z.boolean(),
  photo_type: z.enum(['intake', 'processed', 'auth_card', 'studio']),
})

const UpdateableFieldsSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  condition: z.enum(['new_with_tags', 'new_without_tags', 'like_new', 'very_good', 'good', 'fair', 'poor', 'for_parts']).optional(),
  condition_notes: z.string().optional(),
  suggested_price_cents: z.number().int().positive().optional(),
  final_price_cents: z.number().int().positive().optional(),
  inclusions: z.array(InclusionSchema).optional(),
  auth_plan: z.array(AuthStepSchema).optional(),
  photo_plan: z.array(PhotoShotSchema).optional(),
  platform_fields: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
}).strict()

async function updateListing(
  listingId: string,
  fields: unknown
): Promise<{ ok: true; updated: string[] } | AgentToolError> {
  const parsed = UpdateableFieldsSchema.safeParse(fields)
  if (!parsed.success) {
    return { ok: false, reason: `Invalid fields: ${parsed.error.message}` }
  }

  const updates = parsed.data
  if (Object.keys(updates).length === 0) {
    return { ok: false, reason: 'No fields provided to update' }
  }

  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('listings')
    .update(updates)
    .eq('id', listingId)

  if (error) return { ok: false, reason: `DB update failed: ${error.message}` }

  return { ok: true, updated: Object.keys(updates) }
}

// ─── Tool: get_listing_summary ────────────────────────────────────────────────

async function getListingSummary(listingId: string): Promise<
  { ok: true; [key: string]: unknown } | AgentToolError
> {
  const supabase = getSupabaseAdmin()

  const [listingResult, photoCountResult, convCountResult] = await Promise.all([
    supabase.from('listings').select('*').eq('id', listingId).single(),
    supabase.from('photos').select('id', { count: 'exact', head: true }).eq('listing_id', listingId),
    supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('listing_id', listingId),
  ])

  if (listingResult.error || !listingResult.data) {
    return { ok: false, reason: 'Listing not found' }
  }

  const l = listingResult.data as Record<string, unknown>

  return {
    ok: true,
    id: l.id,
    sku: l.sku,
    status: l.status,
    brand: l.brand,
    category: l.category,
    condition: l.condition,
    condition_notes: l.condition_notes,
    title: l.title,
    description: typeof l.description === 'string' ? l.description.slice(0, 500) : null,
    suggested_price_cents: l.suggested_price_cents,
    final_price_cents: l.final_price_cents,
    confidence_score: l.confidence_score,
    is_luxury: l.is_luxury,
    agent_blocked: l.agent_blocked,
    agent_blocked_reason: l.agent_blocked_reason,
    pipeline_step: l.pipeline_step,
    pipeline_total: l.pipeline_total,
    inclusions: l.inclusions,
    photo_plan: l.photo_plan,
    auth_plan: l.auth_plan,
    tags: l.tags,
    photo_count: photoCountResult.count ?? 0,
    conversation_count: convCountResult.count ?? 0,
  }
}

// ─── Tool: get_photo_plan ─────────────────────────────────────────────────────

async function getPhotoPlan(listingId: string): Promise<
  { ok: true; shots: unknown[]; total: number; uploaded: number; remaining: number } | AgentToolError
> {
  const supabase = getSupabaseAdmin()

  const [listingResult, photosResult] = await Promise.all([
    supabase.from('listings').select('photo_plan').eq('id', listingId).single(),
    supabase.from('photos').select('type').eq('listing_id', listingId),
  ])

  if (listingResult.error || !listingResult.data) {
    return { ok: false, reason: 'Listing not found' }
  }

  const photoPlan = (listingResult.data.photo_plan as Array<{
    shot: string; description: string; required: boolean; photo_type: string
  }>) ?? []

  const studioPhotoCount = (photosResult.data ?? []).filter((p) => p.type === 'studio').length

  const shots = photoPlan.map((s, i) => ({
    shot: s.shot,
    description: s.description,
    required: s.required,
    photo_type: s.photo_type,
    uploaded: i < studioPhotoCount,
  }))

  const uploaded = Math.min(studioPhotoCount, shots.length)

  return {
    ok: true,
    shots,
    total: shots.length,
    uploaded,
    remaining: Math.max(0, shots.length - uploaded),
  }
}

// ─── Schemas (Anthropic tool definitions) ────────────────────────────────────

export const TOOL_SCHEMAS: Anthropic.Messages.Tool[] = [
  {
    name: 'research_pricing',
    description: 'Research pricing for this listing using sold comp data. Returns suggested price, confidence score, and comparable sales. Call this when the user asks about pricing, price recommendations, or market value.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_auth_checklist',
    description: 'Get the authentication checklist for this listing. Returns checklist steps, completion status, and platform authentication eligibility. Only relevant for luxury items.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'build_description',
    description: 'Generate a new listing description with platform-specific titles and SEO keywords. Returns the generated text but does NOT save it — use update_listing to persist.',
    input_schema: {
      type: 'object',
      properties: {
        tone: {
          type: 'string',
          enum: ['luxury', 'casual', 'technical', 'streetwear'],
          description: 'Writing tone to match item category and buyer audience',
        },
      },
      required: [],
    },
  },
  {
    name: 'update_listing',
    description: 'Update one or more listing fields. Only use this after confirming the values are correct. Writeable fields: title, description, condition, condition_notes, suggested_price_cents, final_price_cents, inclusions, auth_plan, photo_plan, platform_fields, tags.',
    input_schema: {
      type: 'object',
      properties: {
        fields: {
          type: 'object',
          description: 'Object with the fields to update. Only include fields that should change.',
        },
      },
      required: ['fields'],
    },
  },
  {
    name: 'get_listing_summary',
    description: 'Get a full summary of this listing — all fields, photo count, and conversation count. Useful for getting a complete picture before making recommendations.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_photo_plan',
    description: 'Get the photo plan for this listing — what shots are required, what type they are, and how many have been uploaded so far.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
]

// ─── Executor ─────────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  listingId: string,
  input: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case 'research_pricing':    return researchPricing(listingId)
    case 'get_auth_checklist':  return getAuthChecklist(listingId)
    case 'build_description':   return buildDescription(listingId, input.tone as string | undefined)
    case 'update_listing':      return updateListing(listingId, input.fields)
    case 'get_listing_summary': return getListingSummary(listingId)
    case 'get_photo_plan':      return getPhotoPlan(listingId)
    default:
      return { ok: false, reason: `Unknown tool: ${name}` }
  }
}
```

- [ ] **Step 3.2: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3.3: Commit**

```bash
git add src/lib/agent/tools.ts
git commit -m "feat: add agent tools — 6 thick tools + Anthropic schemas + executor"
```

---

## Task 4: `src/lib/agent/chat.ts`

**Files:**
- Create: `src/lib/agent/chat.ts`

The agentic streaming loop. Streams Claude's response, executes tool calls, loops until `end_turn`, persists both user and assistant turns to `conversations`.

- [ ] **Step 4.1: Create `src/lib/agent/chat.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'
import { assembleContext } from './system-prompt'
import { TOOL_SCHEMAS, executeTool } from './tools'

export type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string }
  | { type: 'tool_result'; name: string; ok: boolean }
  | { type: 'done' }
  | { type: 'error'; message: string }

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const MAX_ITERATIONS = 10

export async function streamAgentResponse(
  listingId: string,
  userMessage: string,
  emit: (event: AgentEvent) => void
): Promise<void> {
  const supabase = getSupabaseAdmin()

  await supabase.from('conversations').insert({
    listing_id: listingId,
    role: 'user',
    content: userMessage,
  })

  const { systemBlocks, messages: baseMessages } = await assembleContext(listingId, userMessage)
  let messages: MessageParam[] = baseMessages as MessageParam[]

  let iterations = 0
  let finalAssistantText = ''

  try {
    while (iterations < MAX_ITERATIONS) {
      iterations++

      const stream = client.messages.stream({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemBlocks as Parameters<typeof client.messages.create>[0]['system'],
        tools: TOOL_SCHEMAS,
        messages,
      })

      stream.on('text', (text) => {
        finalAssistantText += text
        emit({ type: 'text', content: text })
      })

      stream.on('content_block_start', (event) => {
        if (event.content_block.type === 'tool_use') {
          emit({ type: 'tool_call', name: (event.content_block as { name: string }).name })
        }
      })

      const finalMessage = await stream.finalMessage()

      if (finalMessage.stop_reason !== 'tool_use') {
        break
      }

      const toolUseBlocks = finalMessage.content.filter(
        (b): b is ToolUseBlock => b.type === 'tool_use'
      )

      const toolResults: MessageParam['content'] = []

      for (const toolUse of toolUseBlocks) {
        const input = toolUse.input as Record<string, unknown>
        const result = await executeTool(toolUse.name, listingId, input)
        const ok = typeof result === 'object' && result !== null && 'ok' in result
          ? (result as { ok: boolean }).ok
          : true

        emit({ type: 'tool_result', name: toolUse.name, ok })

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        })
      }

      messages = [
        ...messages,
        { role: 'assistant', content: finalMessage.content as MessageParam['content'] },
        { role: 'user', content: toolResults },
      ]
    }

    if (iterations >= MAX_ITERATIONS) {
      emit({ type: 'error', message: 'Agent reached iteration limit — conversation may be too complex. Try a more focused question.' })
    }

    if (finalAssistantText) {
      await supabase.from('conversations').insert({
        listing_id: listingId,
        role: 'assistant',
        content: finalAssistantText,
      })
    }

    emit({ type: 'done' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error in agent loop'
    emit({ type: 'error', message })
  }
}
```

- [ ] **Step 4.2: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors. If `content_block_start` event type causes an error, the `event.content_block` field may need a cast — check SDK version types, cast to `{ type: string; name?: string }` if needed.

- [ ] **Step 4.3: Commit**

```bash
git add src/lib/agent/chat.ts
git commit -m "feat: add agent chat loop — streaming SSE with tool execution, max 10 iterations"
```

---

## Task 5: `src/app/api/agent/[listingId]/route.ts`

**Files:**
- Create: `src/app/api/agent/[listingId]/route.ts`

POST handler streams the agent response as SSE. GET handler returns conversation history for the UI.

- [ ] **Step 5.1: Create `src/app/api/agent/[listingId]/route.ts`**

```typescript
import { streamAgentResponse } from '@/lib/agent/chat'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ listingId: string }> }
) {
  const { listingId } = await params
  const body = await req.json() as { message?: string }

  if (!body.message || typeof body.message !== 'string' || body.message.trim() === '') {
    return Response.json({ error: 'message is required' }, { status: 400 })
  }

  const message = body.message.trim()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      await streamAgentResponse(listingId, message, (event) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ listingId: string }> }
) {
  const { listingId } = await params
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from('conversations')
    .select('id, role, content, created_at')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: true })
    .limit(50)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ conversations: data ?? [] })
}
```

- [ ] **Step 5.2: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5.3: Commit**

```bash
git add src/app/api/agent/[listingId]/route.ts
git commit -m "feat: add agent chat API route — POST streaming SSE, GET conversation history"
```

---

## Task 6: File a mcp-exec ticket and verify end-to-end

**Files:**
- No code changes in this task

- [ ] **Step 6.1: File mcp-exec backlog ticket**

```bash
bd create \
  --title="Integrate mcp-exec into research_pricing for data-heavy comp aggregation" \
  --description="The design spec calls for mcp-exec Python runtime (pandas/numpy) for statistical outlier removal and weighted median on large comp sets. Currently research_pricing reads existing pricing_comps rows and computes a simple median in-process. When comp sets grow large (20+ rows), mcp-exec exec() would keep the intermediate data out of context and enable proper statistical analysis. Prerequisites: mcp-exec configured in Claude Code settings. See docs/thick-tools-pattern.md and docs/gap-mcp-skills-recs.md for setup." \
  --type=feature \
  --priority=3
```

- [ ] **Step 6.2: Final type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors across all new files.

- [ ] **Step 6.3: Run dev server and smoke-test**

```bash
npm run dev
```

In a second terminal, find a listing ID in your Supabase DB that has `status = 'in_loop'` and pricing comps. Then:

```bash
# Replace LISTING_ID with a real UUID from your listings table
curl -N -X POST http://localhost:3000/api/agent/LISTING_ID \
  -H "Content-Type: application/json" \
  -d '{"message": "what should I price this at?"}' 2>/dev/null
```

Expected output (SSE stream):
```
data: {"type":"tool_call","name":"research_pricing"}

data: {"type":"tool_result","name":"research_pricing","ok":true}

data: {"type":"text","content":"Based on the pricing research..."}

data: {"type":"text","content":" I recommend..."}

data: {"type":"done"}
```

- [ ] **Step 6.4: Verify conversation persistence**

```bash
curl http://localhost:3000/api/agent/LISTING_ID
```

Expected: `{"conversations":[{"id":"...","role":"user","content":"what should I price this at?","created_at":"..."},{"id":"...","role":"assistant","content":"...","created_at":"..."}]}`

- [ ] **Step 6.5: Close beads issue**

```bash
bd close ai-listings-t4w --reason="Agent system implemented: skills file, system-prompt, 6 thick tools, streaming chat loop, POST/GET API route"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|-----------------|-----------|
| `skills/agent-skills.md` flat file | Task 1 |
| System prompt + cache-optimized context assembly | Task 2 |
| 3 ephemeral cache breakpoints | Task 2 — `systemBlocks` array |
| `research_pricing` tool | Task 3 |
| `get_auth_checklist` tool | Task 3 |
| `build_description` tool (Claude sub-call) | Task 3 |
| `update_listing` tool (Zod whitelist) | Task 3 |
| `get_listing_summary` tool | Task 3 |
| `get_photo_plan` tool | Task 3 |
| Streaming SSE agentic loop | Task 4 |
| Max 10 iterations guard | Task 4 |
| Persist user + assistant turns to `conversations` | Task 4 |
| POST (streaming) + GET (history) API routes | Task 5 |
| mcp-exec deferred to backlog | Task 6 |

**Type consistency check:**
- `PricingResearch.confidence` is `number` (0–100) — `researchPricing` returns a number ✅
- `AuthChecklist.confidence` is `'high' | 'medium' | 'low'` — `getAuthChecklist` returns the string union ✅
- `ListingDescription.platforms[].platform` is `'ebay' | 'poshmark'` — `buildDescription` uses these literals ✅
- `AgentToolError` shape `{ ok: false; reason: string }` — all error returns match ✅
- `assembleContext` returns `systemBlocks` + `messages` — `chat.ts` uses both ✅
- `TOOL_SCHEMAS` type is `Anthropic.Messages.Tool[]` — matches what `client.messages.stream` expects ✅

**Placeholder scan:** No TBDs, TODOs, or vague steps found.
