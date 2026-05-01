# Intake Pipeline Implementation Plan

> **Master plan:** `docs/MASTER-PLAN.md` — start here if you need context on the full project.
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 5 stubbed `step.run()` blocks in the intake pipeline with real implementations — SerpAPI product ID, Claude vision + photo plan, ID verification gate (pause + resume), pricing research, parallel draft + PhotoRoom, conditional auth plan, photo quality gate for studio uploads, retry-step handler, and Supabase Realtime pushes at each step.

**Architecture:** Each pipeline step is a standalone async function in `src/lib/pipeline/`. The Inngest function orchestrates them in sequence/parallel, pushing `pipeline_step` updates to Supabase Realtime after each step. The ID gate pauses via `step.waitForEvent()` and resumes when the user confirms via an API route. Steps 4a (Claude draft) and 4b (PhotoRoom) run concurrently via `Promise.all([step.run(), step.run()])`. A separate Inngest function handles `pipeline/retry-step` events for the "Retry" button in the UI. A second separate function handles `studio/uploaded` for the photo quality gate.

**Tech Stack:** Next.js 16 App Router, Inngest v4, Supabase JS v2, Anthropic SDK (`@anthropic-ai/sdk`), SerpAPI REST, Apify REST, PhotoRoom REST. All Claude calls use `claude-sonnet-4-6`.

---

## Prerequisites

Before executing:
- `ANTHROPIC_API_KEY` in `.env.local` (required — API billing account, not the Claude subscription)
- `SERPAPI_API_KEY` in `.env.local`
- `APIFY_TOKEN` in `.env.local`
- `PHOTOROOM_API_KEY` in `.env.local`
- Supabase Storage "photos" bucket must be public (created in Task 1)

---

## File Map

| File | Responsibility |
|------|---------------|
| `src/lib/inngest/client.ts` | Add `pipeline/id-confirmed` and `studio/uploaded` event interfaces |
| `src/lib/pipeline/supabase-push.ts` | **New** — `pushPipelineStep()` helper: update listing fields + `pipeline_step` atomically |
| `src/lib/pipeline/step1-product-id.ts` | **New** — SerpAPI Google Lens call; determines category, assigns SKU |
| `src/lib/pipeline/step2-vision-analysis.ts` | **New** — Claude vision structured call; extracts brand/condition/features/photo_plan/is_luxury |
| `src/lib/pipeline/step3-pricing-research.ts` | **New** — Apify eBay sold comps + SerpAPI cross-platform (luxury); inserts `pricing_comps` rows |
| `src/lib/pipeline/step4a-draft-listing.ts` | **New** — Claude text call; generates title/description/platform_fields/suggested_price |
| `src/lib/pipeline/step4b-photoroom.ts` | **New** — Downloads intake photo, sends to PhotoRoom, stores processed image |
| `src/lib/pipeline/step5-auth-plan.ts` | **New** — Claude text call; generates luxury auth checklist |
| `src/lib/inngest/functions/intake-pipeline.ts` | **Replace** skeleton with full orchestration + ID gate loop + parallel 4a/4b + conditional 5 |
| `src/lib/inngest/functions/retry-step.ts` | **New** — Handles `pipeline/retry-step`; re-runs specific step module |
| `src/lib/inngest/functions/photo-quality-gate.ts` | **New** — Handles `studio/uploaded`; Claude quality check; blocks bad photos |
| `src/app/api/upload/route.ts` | **New** — Intake photo upload: storage + listing create + `photo/uploaded` event |
| `src/app/api/pipeline/confirm-id/route.ts` | **New** — ID gate confirmation: fires `pipeline/id-confirmed` event |
| `src/app/api/pipeline/retry-step/route.ts` | **New** — Retry button: fires `pipeline/retry-step` event |
| `src/app/api/studio-upload/route.ts` | **New** — Studio photo upload: storage + `studio/uploaded` event |
| `src/app/api/inngest/route.ts` | **Modify** — Register `retryStep` and `photoQualityGate` functions |

---

## Task 1: Install Anthropic SDK + create Supabase Storage bucket

**Files:**
- Modify: `package.json` (via npm install)
- No code changes — bucket created via Supabase dashboard / CLI

- [ ] **Step 1.1: Install Anthropic SDK**

```bash
cd /Users/joeblack/github/joeblackwaslike/ai-listings
npm install @anthropic-ai/sdk
```

Expected: `added 1 package` (or similar); no peer dependency errors.

- [ ] **Step 1.2: Create Supabase Storage "photos" bucket**

```bash
npx supabase@latest storage create photos --public
```

If the CLI command fails (older supabase CLI version), create via the dashboard:
Supabase Dashboard → Storage → New Bucket → name: `photos`, Public: ✓.

- [ ] **Step 1.3: Verify bucket exists**

```bash
npx supabase@latest storage ls
```

Expected: `photos` listed.

- [ ] **Step 1.4: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add @anthropic-ai/sdk, create Supabase photos storage bucket"
```

---

## Task 2: Update Inngest client event types

**Files:**
- Modify: `src/lib/inngest/client.ts`

The existing client exports bare interfaces. Add two more for events fired during pipeline execution.

- [ ] **Step 2.1: Add new event interfaces to `src/lib/inngest/client.ts`**

```typescript
import { Inngest } from 'inngest'

export const inngest = new Inngest({ id: 'ai-listings' })

export interface PhotoUploadedEvent {
  name: 'photo/uploaded'
  data: {
    listingId: string
    photoUrl: string
    uploadedAt: string
  }
}

export interface PipelineRetryStepEvent {
  name: 'pipeline/retry-step'
  data: {
    listingId: string
    step: number
  }
}

export interface PipelineIdConfirmedEvent {
  name: 'pipeline/id-confirmed'
  data: {
    listingId: string
    confirmed: boolean
    corrections: string | null
  }
}

export interface StudioUploadedEvent {
  name: 'studio/uploaded'
  data: {
    listingId: string
    photoId: string
    photoUrl: string
  }
}
```

- [ ] **Step 2.2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2.3: Commit**

```bash
git add src/lib/inngest/client.ts
git commit -m "feat: add pipeline/id-confirmed and studio/uploaded event interfaces"
```

---

## Task 3: Supabase push helper

**Files:**
- Create: `src/lib/pipeline/supabase-push.ts`

Every pipeline step calls this to atomically update the listing and advance `pipeline_step`. Supabase Realtime picks up the `listings` row change and pushes it to subscribed browser clients.

- [ ] **Step 3.1: Create `src/lib/pipeline/supabase-push.ts`**

```typescript
import { createClient } from '@supabase/supabase-js'
import type { ListingStatus } from '@/types/listings'

interface PipelineUpdate {
  pipeline_step?: number
  status?: ListingStatus
  [column: string]: unknown
}

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function pushPipelineStep(
  listingId: string,
  updates: PipelineUpdate
): Promise<void> {
  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('listings')
    .update(updates)
    .eq('id', listingId)

  if (error) {
    throw new Error(`supabase-push: ${error.message}`)
  }
}

export { getSupabaseAdmin }
```

- [ ] **Step 3.2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3.3: Commit**

```bash
git add src/lib/pipeline/supabase-push.ts
git commit -m "feat: add pushPipelineStep helper for Realtime-backed listing updates"
```

---

## Task 4: Step 1 — Product ID (SerpAPI Google Lens)

**Files:**
- Create: `src/lib/pipeline/step1-product-id.ts`

Calls SerpAPI's Google Lens engine with the intake photo URL. Extracts product title, brand, and visual matches. Determines category via keyword matching on the match titles. Assigns a SKU by calling `generate_sku()` in Postgres. Updates the listing.

- [ ] **Step 4.1: Create `src/lib/pipeline/step1-product-id.ts`**

```typescript
import type { ListingCategory } from '@/types/listings'
import { getSupabaseAdmin, pushPipelineStep } from './supabase-push'

interface LensMatch {
  title: string
  link: string
  thumbnail: string
  source: string
  price?: { value: string; extracted_value: number; currency: string }
}

interface SerpApiLensResponse {
  search_metadata: { status: string }
  visual_matches?: LensMatch[]
  knowledge_graph?: {
    title?: string
    type?: string
    description?: string
    attributes?: Record<string, string>
  }
  error?: string
}

export interface Step1Result {
  ok: true
  title: string
  brand: string
  category: ListingCategory
  sku: string
  lensMatches: LensMatch[]
  rawLensResponse: SerpApiLensResponse
}

type Step1Error = { ok: false; reason: string }

function inferCategory(matches: LensMatch[]): ListingCategory {
  const allTitles = matches.map((m) => m.title.toLowerCase()).join(' ')

  if (/bag|purse|handbag|clutch|tote|satchel|crossbody/.test(allTitles))
    return 'handbag'
  if (/sneaker|shoe|boot|sandal|louboutin|jordan|nike air/.test(allTitles))
    return 'sneakers'
  if (
    /phone|laptop|tablet|watch|camera|headphone|iphone|macbook|airpod/.test(
      allTitles
    )
  )
    return 'electronics'
  if (/ring|necklace|bracelet|earring|pendant|diamond|gold jewelry/.test(allTitles))
    return 'jewelry'
  if (
    /shirt|dress|jacket|coat|pant|jeans|skirt|blouse|sweater|hoodie|legging/.test(
      allTitles
    )
  )
    return 'clothing'

  return 'other'
}

function inferBrand(matches: LensMatch[]): string {
  const luxuryBrands = [
    'Chanel',
    'Louis Vuitton',
    'Gucci',
    'Hermès',
    'Prada',
    'Balenciaga',
    'Christian Louboutin',
    'Dior',
    'Burberry',
    'Versace',
    'Saint Laurent',
    'Bottega Veneta',
  ]
  const sneakerBrands = ['Nike', 'Jordan', 'Adidas', 'New Balance', 'Puma', 'Vans']
  const allBrands = [...luxuryBrands, ...sneakerBrands]

  const allTitles = matches.map((m) => m.title).join(' ')

  for (const brand of allBrands) {
    if (allTitles.toLowerCase().includes(brand.toLowerCase())) {
      return brand
    }
  }

  // Fall back to first word of the top match title
  const firstTitle = matches[0]?.title ?? ''
  return firstTitle.split(' ')[0] ?? 'Unknown'
}

export async function runStep1ProductId(
  listingId: string,
  photoUrl: string
): Promise<Step1Result> {
  const url = new URL('https://serpapi.com/search')
  url.searchParams.set('engine', 'google_lens')
  url.searchParams.set('url', photoUrl)
  url.searchParams.set('api_key', process.env.SERPAPI_API_KEY!)

  const response = await fetch(url.toString())

  if (!response.ok) {
    throw new Error(`step1: SerpAPI returned HTTP ${response.status}`)
  }

  const data = (await response.json()) as SerpApiLensResponse

  if (data.error) {
    throw new Error(`step1: SerpAPI error — ${data.error}`)
  }

  const matches = data.visual_matches ?? []

  if (matches.length === 0) {
    throw new Error('step1: SerpAPI returned zero visual matches')
  }

  const category = inferCategory(matches)
  const brand = inferBrand(matches)
  const title = data.knowledge_graph?.title ?? matches[0].title

  // Assign SKU atomically via Postgres function
  const supabase = getSupabaseAdmin()
  const prefix = {
    handbag: 'HB',
    clothing: 'CL',
    sneakers: 'SN',
    electronics: 'EL',
    jewelry: 'JW',
    collectibles: 'CO',
    other: 'OT',
  }[category]

  const { data: skuData, error: skuError } = await supabase.rpc('generate_sku', {
    prefix,
  })

  if (skuError) {
    throw new Error(`step1: generate_sku failed — ${skuError.message}`)
  }

  const sku = skuData as string

  await pushPipelineStep(listingId, {
    pipeline_step: 1,
    sku,
    category,
    brand,
    intake_meta: { lensMatches: matches, rawLensResponse: data },
  })

  return {
    ok: true,
    title,
    brand,
    category,
    sku,
    lensMatches: matches,
    rawLensResponse: data,
  }
}
```

- [ ] **Step 4.2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4.3: Commit**

```bash
git add src/lib/pipeline/step1-product-id.ts
git commit -m "feat: add Step 1 — SerpAPI Google Lens product ID + SKU assignment"
```

---

## Task 5: Step 2 — Vision analysis + photo plan (Claude)

**Files:**
- Create: `src/lib/pipeline/step2-vision-analysis.ts`

Single Claude vision call that: confirms brand/category, assesses condition, extracts visible inclusions, determines if item is luxury, and generates the shot checklist (photo plan) for the studio session. Uses structured output via Claude tool_use.

- [ ] **Step 5.1: Create `src/lib/pipeline/step2-vision-analysis.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk'
import type { ListingCategory, ConditionValue, PhotoShot, Inclusion } from '@/types/listings'
import type { Step1Result } from './step1-product-id'
import { pushPipelineStep } from './supabase-push'

const LUXURY_BRANDS = new Set([
  'Chanel',
  'Louis Vuitton',
  'Gucci',
  'Hermès',
  'Prada',
  'Balenciaga',
  'Christian Louboutin',
  'Dior',
  'Burberry',
  'Versace',
  'Saint Laurent',
  'Bottega Veneta',
  'Fendi',
  'Valentino',
  'Givenchy',
])

export interface Step2Result {
  ok: true
  brand: string
  category: ListingCategory
  condition: ConditionValue
  conditionNotes: string
  notableFeatures: string[]
  isLuxury: boolean
  inclusions: Inclusion[]
  photoPlan: PhotoShot[]
  confidenceNote: string
}

type VisionOutput = {
  brand: string
  category: ListingCategory
  condition: ConditionValue
  condition_notes: string
  notable_features: string[]
  inclusions: Array<{ item: string; included: boolean; notes: string | null }>
  photo_plan: Array<{
    shot: string
    description: string
    required: boolean
    photo_type: 'intake' | 'processed' | 'auth_card' | 'studio'
  }>
  confidence_note: string
}

export async function runStep2VisionAnalysis(
  listingId: string,
  photoUrl: string,
  step1: Step1Result,
  corrections: string | null = null
): Promise<Step2Result> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const correctionContext = corrections
    ? `\n\nUSER CORRECTION: The previous identification was wrong. The user says: "${corrections}". Prioritize this correction.`
    : ''

  const prompt = `You are analyzing a product photo for a resale listing platform.

Google Lens previously identified this item as: "${step1.title}" (brand: ${step1.brand}, category: ${step1.category}).
Top lens matches: ${step1.lensMatches
    .slice(0, 3)
    .map((m) => m.title)
    .join('; ')}.
${correctionContext}

Analyze the photo carefully and extract the structured product information using the extract_product_info tool.

For the photo plan, generate an item-specific shot checklist for the studio session. Examples by category:
- handbag: front flat, back flat, bottom, interior open, all hardware close-up, brand stamp, date code, auth card, serial number, strap, zipper pulls, any damage areas
- sneakers: side profile (both shoes), toe box, heel, insole, box label, hangtag, any creasing or scuffs
- electronics: front powered off, front powered on (boot/home screen), back, all ports, serial/IMEI label, all accessories, any damage
- clothing: front flat, back flat, brand tag, care label, measurement reference, any wear/damage`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    tools: [
      {
        name: 'extract_product_info',
        description: 'Extract structured product identification and analysis from the photo',
        input_schema: {
          type: 'object' as const,
          properties: {
            brand: { type: 'string', description: 'Confirmed brand name' },
            category: {
              type: 'string',
              enum: [
                'handbag',
                'clothing',
                'sneakers',
                'electronics',
                'jewelry',
                'collectibles',
                'other',
              ],
            },
            condition: {
              type: 'string',
              enum: [
                'new_with_tags',
                'new_without_tags',
                'like_new',
                'very_good',
                'good',
                'fair',
                'poor',
                'for_parts',
              ],
            },
            condition_notes: {
              type: 'string',
              description: 'Specific condition details visible in this photo',
            },
            notable_features: {
              type: 'array',
              items: { type: 'string' },
              description: 'Key attributes: size, color, hardware, model number, colorway, etc.',
            },
            inclusions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  item: { type: 'string' },
                  included: { type: 'boolean' },
                  notes: { type: 'string', nullable: true },
                },
                required: ['item', 'included', 'notes'],
              },
              description: 'Items visible alongside the product (box, dust bag, auth card, etc.)',
            },
            photo_plan: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  shot: { type: 'string' },
                  description: { type: 'string' },
                  required: { type: 'boolean' },
                  photo_type: { type: 'string', enum: ['studio', 'auth_card'] },
                },
                required: ['shot', 'description', 'required', 'photo_type'],
              },
              description: 'Studio shot checklist specific to this item',
            },
            confidence_note: {
              type: 'string',
              description:
                'Brief note on identification confidence (e.g. "High — clear brand stamp visible")',
            },
          },
          required: [
            'brand',
            'category',
            'condition',
            'condition_notes',
            'notable_features',
            'inclusions',
            'photo_plan',
            'confidence_note',
          ],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'extract_product_info' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'url', url: photoUrl },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
  })

  const toolUse = response.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('step2: Claude did not return a tool_use block')
  }

  const output = toolUse.input as VisionOutput
  const isLuxury = LUXURY_BRANDS.has(output.brand)

  await pushPipelineStep(listingId, {
    pipeline_step: 2,
    status: 'id_gate',
    brand: output.brand,
    category: output.category,
    condition: output.condition,
    condition_notes: output.condition_notes,
    is_luxury: isLuxury,
    inclusions: output.inclusions,
    photo_plan: output.photo_plan,
    intake_meta: {
      lensMatches: step1.lensMatches,
      visionAnalysis: output,
      corrections,
    },
  })

  return {
    ok: true,
    brand: output.brand,
    category: output.category,
    condition: output.condition,
    conditionNotes: output.condition_notes,
    notableFeatures: output.notable_features,
    isLuxury,
    inclusions: output.inclusions,
    photoPlan: output.photo_plan,
    confidenceNote: output.confidence_note,
  }
}
```

- [ ] **Step 5.2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5.3: Commit**

```bash
git add src/lib/pipeline/step2-vision-analysis.ts
git commit -m "feat: add Step 2 — Claude vision analysis + photo plan generation"
```

---

## Task 6: Step 3 — Pricing research

**Files:**
- Create: `src/lib/pipeline/step3-pricing-research.ts`

Two parallel sub-requests: Apify eBay sold listings actor (all items) and SerpAPI cross-platform (luxury only). Inserts `pricing_comps` rows. Calculates confidence score based on comp count, recency, and condition match.

- [ ] **Step 6.1: Create `src/lib/pipeline/step3-pricing-research.ts`**

```typescript
import { getSupabaseAdmin, pushPipelineStep } from './supabase-push'
import type { Step2Result } from './step2-vision-analysis'

interface EbayItem {
  title: string
  price: string
  condition: string
  url: string
  sold_date?: string
}

interface ApifyRunResult {
  items: EbayItem[]
}

interface SerpShoppingResult {
  title: string
  price: { value: string; extracted_value: number; currency: string }
  link: string
  source: string
  condition?: string
}

interface SerpApiShoppingResponse {
  shopping_results?: SerpShoppingResult[]
  error?: string
}

async function fetchEbayComps(
  brand: string,
  category: string,
  model: string
): Promise<EbayItem[]> {
  const query = `${brand} ${model} ${category}`

  // Apify eBay Sold Listings actor — run synchronously (waits for result)
  const response = await fetch(
    `https://api.apify.com/v2/acts/dtrungtin~ebay-items-scraper/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}&memory=256`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        search: query,
        maxItems: 20,
        completed: true,
      }),
    }
  )

  if (!response.ok) {
    throw new Error(`step3: Apify returned HTTP ${response.status}`)
  }

  return (await response.json()) as EbayItem[]
}

async function fetchSerpComps(
  brand: string,
  model: string
): Promise<SerpShoppingResult[]> {
  const query = `${brand} ${model} resale sold price site:poshmark.com OR site:therealreal.com`
  const url = new URL('https://serpapi.com/search')
  url.searchParams.set('engine', 'google_shopping')
  url.searchParams.set('q', query)
  url.searchParams.set('api_key', process.env.SERPAPI_API_KEY!)
  url.searchParams.set('num', '10')

  const response = await fetch(url.toString())

  if (!response.ok) {
    throw new Error(`step3: SerpAPI shopping returned HTTP ${response.status}`)
  }

  const data = (await response.json()) as SerpApiShoppingResponse
  return data.shopping_results ?? []
}

function parsePriceCents(priceStr: string): number {
  const num = parseFloat(priceStr.replace(/[^0-9.]/g, ''))
  return isNaN(num) ? 0 : Math.round(num * 100)
}

function conditionDelta(
  listingCondition: string,
  compCondition: string
): 'same' | 'better' | 'worse' {
  const conditionRank: Record<string, number> = {
    new_with_tags: 8,
    new_without_tags: 7,
    like_new: 6,
    very_good: 5,
    good: 4,
    fair: 3,
    poor: 2,
    for_parts: 1,
  }
  const listingRank = conditionRank[listingCondition] ?? 4
  const compRank = compCondition.toLowerCase().includes('like new')
    ? 6
    : compCondition.toLowerCase().includes('good')
      ? 4
      : compCondition.toLowerCase().includes('new')
        ? 7
        : 4

  if (listingRank > compRank) return 'better'
  if (listingRank < compRank) return 'worse'
  return 'same'
}

function adjustForCondition(priceCents: number, delta: 'same' | 'better' | 'worse'): number {
  if (delta === 'better') return Math.round(priceCents * 1.15)
  if (delta === 'worse') return Math.round(priceCents * 0.85)
  return priceCents
}

function calcConfidenceScore(compCount: number): number {
  if (compCount >= 10) return 90
  if (compCount >= 6) return 75
  if (compCount >= 3) return 60
  if (compCount >= 1) return 40
  return 20
}

export async function runStep3PricingResearch(
  listingId: string,
  step2: Step2Result,
  model: string
): Promise<void> {
  const supabase = getSupabaseAdmin()

  // Run eBay comps (always) and SerpAPI cross-platform (luxury only) in parallel
  const [ebayItems, serpResults] = await Promise.all([
    fetchEbayComps(step2.brand, step2.category, model),
    step2.isLuxury ? fetchSerpComps(step2.brand, model) : Promise.resolve([]),
  ])

  const compRows: Array<{
    listing_id: string
    source: string
    title: string
    sale_price_cents: number
    condition: string
    sold_at: string | null
    listing_url: string
    condition_delta: 'same' | 'better' | 'worse'
    adjusted_price_cents: number
  }> = []

  for (const item of ebayItems) {
    const priceCents = parsePriceCents(item.price)
    if (priceCents === 0) continue
    const delta = conditionDelta(step2.condition, item.condition)
    compRows.push({
      listing_id: listingId,
      source: 'ebay',
      title: item.title,
      sale_price_cents: priceCents,
      condition: item.condition,
      sold_at: item.sold_date ?? null,
      listing_url: item.url,
      condition_delta: delta,
      adjusted_price_cents: adjustForCondition(priceCents, delta),
    })
  }

  for (const result of serpResults) {
    if (!result.price?.extracted_value) continue
    const priceCents = Math.round(result.price.extracted_value * 100)
    const source = result.source?.toLowerCase().includes('poshmark')
      ? 'poshmark'
      : result.source?.toLowerCase().includes('therealreal')
        ? 'therealreal'
        : 'google'
    const delta = conditionDelta(step2.condition, result.condition ?? 'unknown')
    compRows.push({
      listing_id: listingId,
      source,
      title: result.title,
      sale_price_cents: priceCents,
      condition: result.condition ?? 'Not specified',
      sold_at: null,
      listing_url: result.link,
      condition_delta: delta,
      adjusted_price_cents: adjustForCondition(priceCents, delta),
    })
  }

  if (compRows.length > 0) {
    const { error } = await supabase.from('pricing_comps').insert(compRows)
    if (error) {
      throw new Error(`step3: pricing_comps insert failed — ${error.message}`)
    }
  }

  const confidenceScore = calcConfidenceScore(compRows.length)

  // Calculate suggested price as median of adjusted prices
  const prices = compRows.map((r) => r.adjusted_price_cents).sort((a, b) => a - b)
  const mid = Math.floor(prices.length / 2)
  const suggestedPriceCents =
    prices.length === 0
      ? null
      : prices.length % 2 === 0
        ? Math.round((prices[mid - 1] + prices[mid]) / 2)
        : prices[mid]

  await pushPipelineStep(listingId, {
    pipeline_step: 3,
    confidence_score: confidenceScore,
    suggested_price_cents: suggestedPriceCents,
  })
}
```

- [ ] **Step 6.2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6.3: Commit**

```bash
git add src/lib/pipeline/step3-pricing-research.ts
git commit -m "feat: add Step 3 — Apify eBay comps + SerpAPI cross-platform pricing"
```

---

## Task 7: Step 4a — Claude draft listing

**Files:**
- Create: `src/lib/pipeline/step4a-draft-listing.ts`

Claude text-only call to generate the canonical title, description, platform-specific variants (eBay 80-char + Poshmark), item specifics, and suggested price validation. Reads `pricing_comps` to include in the prompt.

- [ ] **Step 7.1: Create `src/lib/pipeline/step4a-draft-listing.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { getSupabaseAdmin, pushPipelineStep } from './supabase-push'
import type { Step2Result } from './step2-vision-analysis'

interface DraftOutput {
  canonical_title: string
  canonical_description: string
  ebay_title: string
  ebay_description: string
  ebay_category_id: string
  ebay_item_specifics: Record<string, string>
  poshmark_title: string
  poshmark_description: string
  poshmark_category: string
  poshmark_size: string
  suggested_price_cents: number
  seo_keywords: string[]
}

export async function runStep4aDraftListing(
  listingId: string,
  step2: Step2Result,
  suggestedPriceCents: number | null
): Promise<void> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const supabase = getSupabaseAdmin()

  // Load recent comps for context
  const { data: comps } = await supabase
    .from('pricing_comps')
    .select('source, title, sale_price_cents, condition, condition_delta, adjusted_price_cents')
    .eq('listing_id', listingId)
    .order('adjusted_price_cents')
    .limit(8)

  const compsText =
    comps && comps.length > 0
      ? comps
          .map(
            (c) =>
              `${c.source}: "${c.title}" — $${(c.adjusted_price_cents / 100).toFixed(0)} adjusted (${c.condition}, ${c.condition_delta} condition)`
          )
          .join('\n')
      : 'No comps available'

  const priceHint = suggestedPriceCents
    ? `Suggested price from comps: $${(suggestedPriceCents / 100).toFixed(0)}.`
    : 'No pricing data available — suggest a reasonable price.'

  const prompt = `Generate a complete resale listing for this item.

Item details:
- Brand: ${step2.brand}
- Category: ${step2.category}
- Condition: ${step2.condition}
- Condition notes: ${step2.conditionNotes}
- Notable features: ${step2.notableFeatures.join(', ')}
- Inclusions: ${step2.inclusions
    .filter((i) => i.included)
    .map((i) => i.item)
    .join(', ') || 'None noted'}

Comparable sold prices:
${compsText}

${priceHint}

Use the generate_listing tool to produce the full listing.

Rules:
- Canonical title: brand + model + key attributes, not platform-specific
- eBay title: exactly 80 chars or fewer, keyword-rich (buyers search "Chanel Classic Flap Medium Black Gold Hardware")
- Poshmark title: natural, 60 chars max
- eBay item specifics: brand, style/model, color, material, condition, size/dimensions where relevant
- eBay category_id: use standard eBay category ID numbers (Handbags: 169291, Sneakers: 155202, Electronics/phones: 9355, Clothing tops: 53159)
- Descriptions should be factual, buyer-oriented, no filler phrases like "don't miss out"`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    tools: [
      {
        name: 'generate_listing',
        description: 'Generate all listing fields for a resale item',
        input_schema: {
          type: 'object' as const,
          properties: {
            canonical_title: { type: 'string' },
            canonical_description: { type: 'string' },
            ebay_title: {
              type: 'string',
              description: 'Max 80 characters, keyword-optimized',
            },
            ebay_description: { type: 'string' },
            ebay_category_id: { type: 'string' },
            ebay_item_specifics: {
              type: 'object',
              additionalProperties: { type: 'string' },
            },
            poshmark_title: { type: 'string', description: 'Max 60 characters' },
            poshmark_description: { type: 'string' },
            poshmark_category: { type: 'string' },
            poshmark_size: { type: 'string' },
            suggested_price_cents: {
              type: 'integer',
              description: 'Suggested listing price in cents',
            },
            seo_keywords: {
              type: 'array',
              items: { type: 'string' },
              description: 'Top 10 search keywords buyers use for this item',
            },
          },
          required: [
            'canonical_title',
            'canonical_description',
            'ebay_title',
            'ebay_description',
            'ebay_category_id',
            'ebay_item_specifics',
            'poshmark_title',
            'poshmark_description',
            'poshmark_category',
            'poshmark_size',
            'suggested_price_cents',
            'seo_keywords',
          ],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'generate_listing' },
    messages: [{ role: 'user', content: prompt }],
  })

  const toolUse = response.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('step4a: Claude did not return a tool_use block')
  }

  const draft = toolUse.input as DraftOutput

  await pushPipelineStep(listingId, {
    pipeline_step: 4,
    title: draft.canonical_title,
    description: draft.canonical_description,
    suggested_price_cents: draft.suggested_price_cents,
    platform_fields: {
      ebay: {
        title: draft.ebay_title,
        description: draft.ebay_description,
        category_id: draft.ebay_category_id,
        item_specifics: draft.ebay_item_specifics,
        condition_id: step2.condition,
      },
      poshmark: {
        title: draft.poshmark_title,
        description: draft.poshmark_description,
        category: draft.poshmark_category,
        size: draft.poshmark_size,
      },
    },
  })
}
```

- [ ] **Step 7.2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7.3: Commit**

```bash
git add src/lib/pipeline/step4a-draft-listing.ts
git commit -m "feat: add Step 4a — Claude draft listing generation"
```

---

## Task 8: Step 4b — PhotoRoom image processing

**Files:**
- Create: `src/lib/pipeline/step4b-photoroom.ts`

Downloads the intake photo, sends it to PhotoRoom for background removal + staging, stores the processed image in Supabase Storage, creates a `photos` row with `type: 'processed'`.

- [ ] **Step 8.1: Create `src/lib/pipeline/step4b-photoroom.ts`**

```typescript
import { getSupabaseAdmin } from './supabase-push'

interface PhotoRoomResponse {
  result_b64: string
  foreground_top: number
  foreground_left: number
  foreground_width: number
  foreground_height: number
  image_type: string
}

export async function runStep4bPhotoRoom(
  listingId: string,
  photoUrl: string,
  intakePhotoId: string
): Promise<void> {
  const supabase = getSupabaseAdmin()

  // Download the raw intake photo
  const photoResponse = await fetch(photoUrl)
  if (!photoResponse.ok) {
    throw new Error(`step4b: failed to download intake photo — HTTP ${photoResponse.status}`)
  }
  const photoBuffer = await photoResponse.arrayBuffer()

  // Send to PhotoRoom
  const formData = new FormData()
  formData.append(
    'image_file',
    new Blob([photoBuffer], { type: 'image/jpeg' }),
    'photo.jpg'
  )
  formData.append('output_type', 'white_background')
  formData.append('format', 'jpg')

  const photoroomResponse = await fetch('https://sdk.photoroom.com/v1/segment', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.PHOTOROOM_API_KEY!,
    },
    body: formData,
  })

  if (!photoroomResponse.ok) {
    const errText = await photoroomResponse.text()
    throw new Error(`step4b: PhotoRoom returned HTTP ${photoroomResponse.status} — ${errText}`)
  }

  const prData = (await photoroomResponse.json()) as PhotoRoomResponse
  const processedBuffer = Buffer.from(prData.result_b64, 'base64')
  const processedFilePath = `intake/${listingId}/processed.jpg`

  // Store processed image in Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from('photos')
    .upload(processedFilePath, processedBuffer, {
      contentType: 'image/jpeg',
      upsert: true,
    })

  if (uploadError) {
    throw new Error(`step4b: Supabase storage upload failed — ${uploadError.message}`)
  }

  const { data: urlData } = supabase.storage
    .from('photos')
    .getPublicUrl(processedFilePath)

  const processedUrl = urlData.publicUrl

  // Update the photos row for the intake photo with the processed URL
  const { error: photoUpdateError } = await supabase
    .from('photos')
    .update({
      processed_url: processedUrl,
      photoroom_meta: {
        foreground_top: prData.foreground_top,
        foreground_left: prData.foreground_left,
        foreground_width: prData.foreground_width,
        foreground_height: prData.foreground_height,
      },
    })
    .eq('id', intakePhotoId)

  if (photoUpdateError) {
    throw new Error(`step4b: photos row update failed — ${photoUpdateError.message}`)
  }
}
```

- [ ] **Step 8.2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8.3: Commit**

```bash
git add src/lib/pipeline/step4b-photoroom.ts
git commit -m "feat: add Step 4b — PhotoRoom background removal + Supabase Storage"
```

---

## Task 9: Step 5 — Auth plan (luxury only)

**Files:**
- Create: `src/lib/pipeline/step5-auth-plan.ts`

Claude text call to generate an item-specific authentication checklist for luxury items. Only called when `step2.isLuxury === true`.

- [ ] **Step 9.1: Create `src/lib/pipeline/step5-auth-plan.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { pushPipelineStep } from './supabase-push'
import type { Step2Result } from './step2-vision-analysis'
import type { AuthStep } from '@/types/listings'

interface AuthPlanOutput {
  steps: Array<{
    step: string
    guidance: string
    photo_required: boolean
  }>
  platform_auth_note: string
}

export async function runStep5AuthPlan(
  listingId: string,
  step2: Step2Result,
  suggestedPriceCents: number | null
): Promise<void> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const priceNote =
    suggestedPriceCents && suggestedPriceCents >= 50000
      ? `Item is priced at ~$${(suggestedPriceCents / 100).toFixed(0)}, which is ≥$500. eBay Authenticity Guarantee and Poshmark Posh Authenticate handle authentication as part of the sale for items at this price point — the platform bears the cost.`
      : `Item is priced below $500. Self-authentication using the checklist steps is required — platforms may not offer authentication at this price point.`

  const prompt = `Generate an authentication checklist for this luxury resale item.

Item:
- Brand: ${step2.brand}
- Category: ${step2.category}
- Condition: ${step2.condition}
- Features: ${step2.notableFeatures.join(', ')}

${priceNote}

Authentication requirements by brand:
- Chanel: Auth card serial number (12–14 digits, year lookup), hologram sticker placement, quilting pattern consistency, CC logo alignment, hardware gold/silver stamping
- Louis Vuitton: Date code format (letter+number series by factory/year), canvas condition assessment, "Louis Vuitton Paris" stamp, made-in label
- Christian Louboutin: Red sole condition (primary value driver), Loubi insole code (post-2011), leather quality, heel height accuracy
- Gucci: Serial number card (format varies by era), authenticity card, hardware, canvas/leather tells
- General luxury: Hardware stamping, lining quality, stitching consistency, brand stamp placement, date codes if applicable

Do NOT suggest Entrupy, Real Authentication, or other third-party authentication services.
For items ≥ $500: note eBay Authenticity Guarantee / Poshmark Posh Authenticate as the authentication layer.

Use the generate_auth_plan tool.`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    tools: [
      {
        name: 'generate_auth_plan',
        description: 'Generate authentication checklist for a luxury item',
        input_schema: {
          type: 'object' as const,
          properties: {
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  step: { type: 'string', description: 'Short step name' },
                  guidance: {
                    type: 'string',
                    description: 'Specific guidance for this authentication step',
                  },
                  photo_required: {
                    type: 'boolean',
                    description: 'Whether a photo is needed to verify this step',
                  },
                },
                required: ['step', 'guidance', 'photo_required'],
              },
            },
            platform_auth_note: {
              type: 'string',
              description: 'Note about platform authentication eligibility',
            },
          },
          required: ['steps', 'platform_auth_note'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'generate_auth_plan' },
    messages: [{ role: 'user', content: prompt }],
  })

  const toolUse = response.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('step5: Claude did not return a tool_use block')
  }

  const output = toolUse.input as AuthPlanOutput

  const authPlan: AuthStep[] = output.steps.map((s) => ({
    step: s.step,
    guidance: s.guidance,
    status: 'pending',
    photo_required: s.photo_required,
  }))

  await pushPipelineStep(listingId, {
    pipeline_step: 5,
    auth_plan: authPlan,
  })
}
```

- [ ] **Step 9.2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9.3: Commit**

```bash
git add src/lib/pipeline/step5-auth-plan.ts
git commit -m "feat: add Step 5 — Claude auth plan for luxury items"
```

---

## Task 10: Wire the full intake pipeline

**Files:**
- Modify: `src/lib/inngest/functions/intake-pipeline.ts`

Replace the 5 stubbed `step.run()` blocks with real calls. ID gate uses `step.waitForEvent()` in a correction loop (max 3 attempts). Steps 4a + 4b run in parallel. Step 5 conditional on `is_luxury`. `onFailure` updates listing to `in_loop` with the failed step name.

- [ ] **Step 10.1: Replace `src/lib/inngest/functions/intake-pipeline.ts`**

```typescript
import { inngest } from '../client'
import type { PhotoUploadedEvent } from '../client'
import { runStep1ProductId } from '@/lib/pipeline/step1-product-id'
import { runStep2VisionAnalysis } from '@/lib/pipeline/step2-vision-analysis'
import { runStep3PricingResearch } from '@/lib/pipeline/step3-pricing-research'
import { runStep4aDraftListing } from '@/lib/pipeline/step4a-draft-listing'
import { runStep4bPhotoRoom } from '@/lib/pipeline/step4b-photoroom'
import { runStep5AuthPlan } from '@/lib/pipeline/step5-auth-plan'
import { getSupabaseAdmin, pushPipelineStep } from '@/lib/pipeline/supabase-push'

export const intakePipeline = inngest.createFunction(
  {
    id: 'intake-pipeline',
    name: 'Intake Pipeline',
    triggers: [{ event: 'photo/uploaded' }],
    retries: 3,
    onFailure: async ({ error, event }) => {
      const { listingId } = (event as unknown as PhotoUploadedEvent).data
      const reason = error.message ?? 'Unknown pipeline error'

      // Extract step name from error prefix (e.g. "step1: ...")
      const stepMatch = reason.match(/^(step\d+\w*):/i)
      const stepLabel = stepMatch ? stepMatch[1] : 'pipeline'

      const supabase = getSupabaseAdmin()
      await supabase
        .from('listings')
        .update({
          status: 'in_loop',
          agent_blocked: true,
          agent_blocked_reason: `${stepLabel} failed after retries — ${reason.substring(0, 200)}`,
        })
        .eq('id', listingId)
    },
  },
  async ({ event, step }) => {
    const { listingId, photoUrl } = (event as unknown as PhotoUploadedEvent).data

    // Fetch the intake photo record ID (needed by step 4b)
    const supabase = getSupabaseAdmin()
    const { data: photoRow } = await supabase
      .from('photos')
      .select('id')
      .eq('listing_id', listingId)
      .eq('type', 'intake')
      .single()
    const intakePhotoId: string = photoRow?.id ?? ''

    // ── Step 1: Product ID (SerpAPI) ──────────────────────────────
    const step1Result = await step.run('product-id', () =>
      runStep1ProductId(listingId, photoUrl)
    )

    // ── Step 2: Vision analysis + photo plan (Claude) ─────────────
    let step2Result = await step.run('vision-analysis', () =>
      runStep2VisionAnalysis(listingId, photoUrl, step1Result, null)
    )

    // ── ID Verification Gate ──────────────────────────────────────
    // Pause until user confirms or corrects identification.
    // Max 3 correction attempts. step.waitForEvent returns null on timeout (7d).
    let gateAttempt = 0
    while (gateAttempt < 3) {
      const confirmation = await step.waitForEvent(`id-gate-confirm-${gateAttempt}`, {
        event: 'pipeline/id-confirmed',
        timeout: '7d',
        match: 'data.listingId',
      })

      // Timeout — auto-approve and continue rather than blocking forever
      if (confirmation === null) break

      if (
        (confirmation as unknown as { data: { confirmed: boolean } }).data.confirmed
      ) {
        break
      }

      // User provided corrections — re-run vision analysis
      const corrections = (
        confirmation as unknown as { data: { corrections: string | null } }
      ).data.corrections

      step2Result = await step.run(`re-identify-${gateAttempt}`, () =>
        runStep2VisionAnalysis(listingId, photoUrl, step1Result, corrections)
      )

      gateAttempt++
    }

    // ── Step 3: Pricing research ───────────────────────────────────
    const titleForComps = step2Result.notableFeatures.slice(0, 3).join(' ')
    await step.run('pricing-research', () =>
      runStep3PricingResearch(listingId, step2Result, titleForComps)
    )

    // Read suggested price set by step 3 for downstream steps
    const { data: listingAfterStep3 } = await supabase
      .from('listings')
      .select('suggested_price_cents')
      .eq('id', listingId)
      .single()
    const suggestedPriceCents: number | null =
      listingAfterStep3?.suggested_price_cents ?? null

    // ── Steps 4a + 4b: Draft + PhotoRoom (parallel) ───────────────
    await Promise.all([
      step.run('draft-listing', () =>
        runStep4aDraftListing(listingId, step2Result, suggestedPriceCents)
      ),
      step.run('photoroom-process', () =>
        runStep4bPhotoRoom(listingId, photoUrl, intakePhotoId)
      ),
    ])

    // ── Step 5: Auth plan (luxury items only) ─────────────────────
    if (step2Result.isLuxury) {
      await step.run('auth-plan', () =>
        runStep5AuthPlan(listingId, step2Result, suggestedPriceCents)
      )
    }

    // ── Final: mark in_loop ───────────────────────────────────────
    const totalSteps = step2Result.isLuxury ? 5 : 4
    await pushPipelineStep(listingId, {
      status: 'in_loop',
      pipeline_total: totalSteps,
      agent_blocked: false,
      agent_blocked_reason: null,
    })

    return { ok: true, listingId, status: 'in_loop' }
  }
)
```

- [ ] **Step 10.2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 10.3: Commit**

```bash
git add src/lib/inngest/functions/intake-pipeline.ts
git commit -m "feat: implement full intake pipeline — all 5 steps, ID gate, parallel 4a/4b, conditional step 5"
```

---

## Task 11: Upload API routes (intake + studio)

**Files:**
- Create: `src/app/api/upload/route.ts`
- Create: `src/app/api/studio-upload/route.ts`

The intake upload creates the listing, stores the photo, and fires `photo/uploaded`. Studio upload stores the photo and fires `studio/uploaded` for the quality gate.

- [ ] **Step 11.1: Create `src/app/api/upload/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { inngest } from '@/lib/inngest/client'

function getSupabaseAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: Request) {
  const formData = await request.formData()
  const file = formData.get('photo') as File | null

  if (!file) {
    return NextResponse.json({ error: 'No photo provided' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  // Create listing record first to get the ID
  const { data: listing, error: listingError } = await supabase
    .from('listings')
    .insert({ status: 'intake', pipeline_step: 0, pipeline_total: 5 })
    .select('id')
    .single()

  if (listingError || !listing) {
    return NextResponse.json({ error: 'Failed to create listing' }, { status: 500 })
  }

  const listingId: string = listing.id
  const ext = file.name.split('.').pop() ?? 'jpg'
  const storagePath = `intake/${listingId}/original.${ext}`

  // Upload to Supabase Storage
  const buffer = await file.arrayBuffer()
  const { error: uploadError } = await supabase.storage
    .from('photos')
    .upload(storagePath, buffer, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    })

  if (uploadError) {
    return NextResponse.json({ error: 'Storage upload failed' }, { status: 500 })
  }

  const { data: urlData } = supabase.storage.from('photos').getPublicUrl(storagePath)
  const photoUrl = urlData.publicUrl

  // Create photos row
  const { data: photoRow, error: photoError } = await supabase
    .from('photos')
    .insert({
      listing_id: listingId,
      type: 'intake',
      raw_url: photoUrl,
      display_order: 0,
    })
    .select('id')
    .single()

  if (photoError || !photoRow) {
    return NextResponse.json({ error: 'Failed to create photo record' }, { status: 500 })
  }

  // Fire the Inngest event to kick off the pipeline
  await inngest.send({
    name: 'photo/uploaded',
    data: {
      listingId,
      photoUrl,
      uploadedAt: new Date().toISOString(),
    },
  })

  return NextResponse.json({ listingId, photoUrl })
}
```

- [ ] **Step 11.2: Create `src/app/api/studio-upload/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { inngest } from '@/lib/inngest/client'

function getSupabaseAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: Request) {
  const formData = await request.formData()
  const file = formData.get('photo') as File | null
  const listingId = formData.get('listingId') as string | null

  if (!file || !listingId) {
    return NextResponse.json({ error: 'photo and listingId required' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const timestamp = Date.now()
  const ext = file.name.split('.').pop() ?? 'jpg'
  const storagePath = `studio/${listingId}/${timestamp}.${ext}`

  const buffer = await file.arrayBuffer()
  const { error: uploadError } = await supabase.storage
    .from('photos')
    .upload(storagePath, buffer, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    })

  if (uploadError) {
    return NextResponse.json({ error: 'Storage upload failed' }, { status: 500 })
  }

  const { data: urlData } = supabase.storage.from('photos').getPublicUrl(storagePath)
  const photoUrl = urlData.publicUrl

  const { data: photoRow, error: photoError } = await supabase
    .from('photos')
    .insert({
      listing_id: listingId,
      type: 'studio',
      raw_url: photoUrl,
      display_order: timestamp,
    })
    .select('id')
    .single()

  if (photoError || !photoRow) {
    return NextResponse.json({ error: 'Failed to create photo record' }, { status: 500 })
  }

  // Fire event for quality gate Inngest function
  await inngest.send({
    name: 'studio/uploaded',
    data: {
      listingId,
      photoId: photoRow.id as string,
      photoUrl,
    },
  })

  return NextResponse.json({ photoId: photoRow.id, photoUrl })
}
```

- [ ] **Step 11.3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 11.4: Commit**

```bash
git add src/app/api/upload/ src/app/api/studio-upload/
git commit -m "feat: add intake upload route and studio upload route"
```

---

## Task 12: ID gate confirmation API route

**Files:**
- Create: `src/app/api/pipeline/confirm-id/route.ts`

Called by the frontend confirmation card. Fires `pipeline/id-confirmed` which resumes the paused Inngest pipeline.

- [ ] **Step 12.1: Create `src/app/api/pipeline/confirm-id/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { inngest } from '@/lib/inngest/client'

export async function POST(request: Request) {
  const body = (await request.json()) as {
    listingId?: string
    confirmed?: boolean
    corrections?: string | null
  }

  if (!body.listingId || body.confirmed === undefined) {
    return NextResponse.json(
      { error: 'listingId and confirmed are required' },
      { status: 400 }
    )
  }

  await inngest.send({
    name: 'pipeline/id-confirmed',
    data: {
      listingId: body.listingId,
      confirmed: body.confirmed,
      corrections: body.corrections ?? null,
    },
  })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 12.2: Commit**

```bash
git add src/app/api/pipeline/confirm-id/
git commit -m "feat: add ID gate confirmation API route"
```

---

## Task 13: Retry-step handler

**Files:**
- Create: `src/lib/inngest/functions/retry-step.ts`
- Create: `src/app/api/pipeline/retry-step/route.ts`
- Modify: `src/app/api/inngest/route.ts`

The "Retry" button in the listing workspace fires an event that re-runs just the failed step.

- [ ] **Step 13.1: Create `src/lib/inngest/functions/retry-step.ts`**

```typescript
import { inngest } from '../client'
import type { PipelineRetryStepEvent } from '../client'
import { runStep3PricingResearch } from '@/lib/pipeline/step3-pricing-research'
import { runStep4aDraftListing } from '@/lib/pipeline/step4a-draft-listing'
import { runStep4bPhotoRoom } from '@/lib/pipeline/step4b-photoroom'
import { runStep5AuthPlan } from '@/lib/pipeline/step5-auth-plan'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

export const retryStep = inngest.createFunction(
  {
    id: 'retry-step',
    name: 'Retry Pipeline Step',
    triggers: [{ event: 'pipeline/retry-step' }],
    retries: 1,
  },
  async ({ event, step }) => {
    const { listingId, step: stepNum } = (
      event as unknown as PipelineRetryStepEvent
    ).data

    const supabase = getSupabaseAdmin()
    const { data: listing } = await supabase
      .from('listings')
      .select(
        'category, brand, condition, is_luxury, suggested_price_cents, intake_meta'
      )
      .eq('id', listingId)
      .single()

    if (!listing) {
      throw new Error(`retry-step: listing ${listingId} not found`)
    }

    const { data: photoRow } = await supabase
      .from('photos')
      .select('id, raw_url')
      .eq('listing_id', listingId)
      .eq('type', 'intake')
      .single()

    const photoUrl: string = (photoRow?.raw_url as string | null) ?? ''
    const intakePhotoId: string = (photoRow?.id as string | null) ?? ''

    // Reconstruct step2Result shape needed by downstream steps
    const step2Partial = {
      brand: (listing.brand as string) ?? '',
      category: listing.category,
      condition: listing.condition,
      conditionNotes: '',
      notableFeatures: [],
      isLuxury: listing.is_luxury as boolean,
      inclusions: [],
      photoPlan: [],
      confidenceNote: '',
    }

    if (stepNum === 3) {
      await step.run('retry-pricing-research', () =>
        runStep3PricingResearch(listingId, step2Partial as Parameters<typeof runStep3PricingResearch>[1], '')
      )
    } else if (stepNum === 4) {
      await Promise.all([
        step.run('retry-draft-listing', () =>
          runStep4aDraftListing(
            listingId,
            step2Partial as Parameters<typeof runStep4aDraftListing>[1],
            listing.suggested_price_cents as number | null
          )
        ),
        step.run('retry-photoroom', () =>
          runStep4bPhotoRoom(listingId, photoUrl, intakePhotoId)
        ),
      ])
    } else if (stepNum === 5) {
      await step.run('retry-auth-plan', () =>
        runStep5AuthPlan(
          listingId,
          step2Partial as Parameters<typeof runStep5AuthPlan>[1],
          listing.suggested_price_cents as number | null
        )
      )
    } else {
      throw new Error(`retry-step: step ${stepNum} cannot be retried independently (steps 1 and 2 restart the full pipeline)`)
    }

    // Clear the agent_blocked flag if set by onFailure
    await supabase
      .from('listings')
      .update({ agent_blocked: false, agent_blocked_reason: null })
      .eq('id', listingId)

    return { ok: true, listingId, retriedStep: stepNum }
  }
)
```

- [ ] **Step 13.2: Create `src/app/api/pipeline/retry-step/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { inngest } from '@/lib/inngest/client'

export async function POST(request: Request) {
  const body = (await request.json()) as { listingId?: string; step?: number }

  if (!body.listingId || body.step === undefined) {
    return NextResponse.json(
      { error: 'listingId and step are required' },
      { status: 400 }
    )
  }

  await inngest.send({
    name: 'pipeline/retry-step',
    data: {
      listingId: body.listingId,
      step: body.step,
    },
  })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 13.3: Register new functions in `src/app/api/inngest/route.ts`**

```typescript
import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest/client'
import { intakePipeline } from '@/lib/inngest/functions/intake-pipeline'
import { retryStep } from '@/lib/inngest/functions/retry-step'
import { photoQualityGate } from '@/lib/inngest/functions/photo-quality-gate'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [intakePipeline, retryStep, photoQualityGate],
})
```

- [ ] **Step 13.4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 13.5: Commit**

```bash
git add src/lib/inngest/functions/retry-step.ts src/app/api/pipeline/retry-step/ src/app/api/inngest/route.ts
git commit -m "feat: add retry-step Inngest function and API route"
```

---

## Task 14: Photo quality gate

**Files:**
- Create: `src/lib/inngest/functions/photo-quality-gate.ts`

Triggered by `studio/uploaded`. Runs Claude vision quality check on each studio photo. Flags bad photos (blur, exposure, cropping) without sending them to PhotoRoom.

- [ ] **Step 14.1: Create `src/lib/inngest/functions/photo-quality-gate.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { inngest } from '../client'
import type { StudioUploadedEvent } from '../client'
import { getSupabaseAdmin } from '@/lib/pipeline/supabase-push'

interface QualityOutput {
  passed: boolean
  issues: string[]
  verdict: string
}

async function checkPhotoQuality(photoUrl: string): Promise<QualityOutput> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    tools: [
      {
        name: 'quality_check',
        description: 'Evaluate photo quality for a resale listing',
        input_schema: {
          type: 'object' as const,
          properties: {
            passed: {
              type: 'boolean',
              description: 'True if photo is suitable for listing',
            },
            issues: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of specific quality issues found',
            },
            verdict: {
              type: 'string',
              description: 'One-sentence summary of the quality assessment',
            },
          },
          required: ['passed', 'issues', 'verdict'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'quality_check' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: photoUrl } },
          {
            type: 'text',
            text: `Evaluate this product photo for resale listing quality.

Check for:
1. Blur or motion blur — is the subject sharp?
2. Exposure — significantly underexposed (too dark) or overexposed (washed out)?
3. Subject framing — is the main item centered and fully visible (not cut off)?
4. Multiple items in frame — are there multiple distinct items that should be separate listings?

A photo passes if it is sharp, properly exposed, the subject is fully visible, and there is only one main item.`,
          },
        ],
      },
    ],
  })

  const toolUse = response.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('photo-quality-gate: Claude did not return a tool_use block')
  }

  return toolUse.input as QualityOutput
}

export const photoQualityGate = inngest.createFunction(
  {
    id: 'photo-quality-gate',
    name: 'Photo Quality Gate',
    triggers: [{ event: 'studio/uploaded' }],
    retries: 1,
  },
  async ({ event, step }) => {
    const { listingId, photoId, photoUrl } = (
      event as unknown as StudioUploadedEvent
    ).data

    const quality = await step.run('check-quality', () => checkPhotoQuality(photoUrl))

    const supabase = getSupabaseAdmin()

    if (!quality.passed) {
      // Flag the photo with quality issues — do NOT send to PhotoRoom
      await supabase
        .from('photos')
        .update({
          photoroom_meta: {
            quality_failed: true,
            quality_issues: quality.issues,
            quality_verdict: quality.verdict,
          },
        })
        .eq('id', photoId)

      return { ok: false, listingId, photoId, issues: quality.issues }
    }

    // Quality passed — send to PhotoRoom
    const { data: photoRow } = await supabase
      .from('photos')
      .select('raw_url')
      .eq('id', photoId)
      .single()

    if (!photoRow?.raw_url) {
      throw new Error(`photo-quality-gate: photo ${photoId} has no raw_url`)
    }

    // Download and process via PhotoRoom
    const photoResponse = await fetch(photoRow.raw_url as string)
    const photoBuffer = await photoResponse.arrayBuffer()

    const formData = new FormData()
    formData.append(
      'image_file',
      new Blob([photoBuffer], { type: 'image/jpeg' }),
      'photo.jpg'
    )
    formData.append('output_type', 'white_background')
    formData.append('format', 'jpg')

    const prResponse = await fetch('https://sdk.photoroom.com/v1/segment', {
      method: 'POST',
      headers: { 'x-api-key': process.env.PHOTOROOM_API_KEY! },
      body: formData,
    })

    if (!prResponse.ok) {
      throw new Error(`photo-quality-gate: PhotoRoom HTTP ${prResponse.status}`)
    }

    const prData = (await prResponse.json()) as { result_b64: string }
    const processedBuffer = Buffer.from(prData.result_b64, 'base64')
    const storagePath = `studio/${listingId}/processed-${photoId}.jpg`

    await supabase.storage.from('photos').upload(storagePath, processedBuffer, {
      contentType: 'image/jpeg',
      upsert: true,
    })

    const { data: urlData } = supabase.storage.from('photos').getPublicUrl(storagePath)

    await supabase
      .from('photos')
      .update({ processed_url: urlData.publicUrl })
      .eq('id', photoId)

    return { ok: true, listingId, photoId }
  }
)
```

- [ ] **Step 14.2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 14.3: Commit**

```bash
git add src/lib/inngest/functions/photo-quality-gate.ts
git commit -m "feat: add photo quality gate — Claude vision check on studio photos before PhotoRoom"
```

---

## Task 15: Build check + end-to-end smoke test

**Files:**
- No new files — verify everything assembles correctly.

- [ ] **Step 15.1: Full TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors. Fix any remaining type issues before continuing.

- [ ] **Step 15.2: Build check**

```bash
npm run build
```

Expected: `✓ Compiled successfully`. All 3 Inngest functions should appear as routes.

- [ ] **Step 15.3: Start dev servers (two terminals)**

Terminal 1:
```bash
npm run dev
```

Terminal 2:
```bash
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

Expected: Inngest dev console at `http://localhost:8288` showing 3 functions:
- `intake-pipeline`
- `retry-step`
- `photo-quality-gate`

- [ ] **Step 15.4: Upload a real test photo**

```bash
curl -X POST http://localhost:3000/api/upload \
  -F "photo=@/path/to/test-photo.jpg"
```

Expected response:
```json
{ "listingId": "abc-123-...", "photoUrl": "https://..." }
```

Note the `listingId`.

- [ ] **Step 15.5: Watch Inngest dev console**

In `http://localhost:8288` → Functions → `intake-pipeline`:
- Steps 1 and 2 should complete in ~10–15s (SerpAPI + Claude)
- Pipeline pauses at `id-gate-confirm-0` — the `waitForEvent` is active

Check Supabase:
```bash
npx supabase@latest db execute --command "
  select id, sku, status, brand, category, pipeline_step, is_luxury
  from listings
  order by created_at desc
  limit 1;
"
```

Expected: `status = 'id_gate'`, `pipeline_step = 2`, `brand` and `category` populated.

- [ ] **Step 15.6: Confirm ID and resume pipeline**

```bash
curl -X POST http://localhost:3000/api/pipeline/confirm-id \
  -H "Content-Type: application/json" \
  -d '{"listingId": "<id from step 15.4>", "confirmed": true, "corrections": null}'
```

Expected: `{"ok":true}`

Watch Inngest — the pipeline should resume, complete steps 3, 4a, 4b (and step 5 if luxury).

- [ ] **Step 15.7: Verify final listing state**

```bash
npx supabase@latest db execute --command "
  select
    id, sku, status, brand, category, condition,
    pipeline_step, pipeline_total, suggested_price_cents,
    title, is_luxury, agent_blocked
  from listings
  order by created_at desc
  limit 1;
"
```

Expected: `status = 'in_loop'`, `title` populated, `suggested_price_cents` > 0, `agent_blocked = false`.

```bash
npx supabase@latest db execute --command "
  select count(*) as comp_count from pricing_comps
  where listing_id = (select id from listings order by created_at desc limit 1);
"
```

Expected: `comp_count` > 0 (comps found and inserted).

```bash
npx supabase@latest db execute --command "
  select id, type, raw_url, processed_url is not null as has_processed
  from photos
  where listing_id = (select id from listings order by created_at desc limit 1);
"
```

Expected: intake photo row with `has_processed = true` (PhotoRoom ran successfully).

- [ ] **Step 15.8: Final commit**

```bash
git add .
git commit -m "chore: full intake pipeline smoke test passed — all 5 steps, ID gate, pricing, draft, PhotoRoom"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Task |
|-----------------|------|
| Step 1: SerpAPI Google Lens, store in `intake_meta` | Task 4 |
| Step 1: Category determination + SKU assignment via `generate_sku()` | Task 4 |
| Step 2: Claude vision — brand, condition, features, photo plan | Task 5 |
| Step 2: Luxury brand detection | Task 5 |
| Step 2: Inclusions visible in photo | Task 5 |
| ID gate: pause pipeline, surface `id_gate` status | Task 10 (`waitForEvent`) |
| ID gate: user corrections → re-run vision analysis | Task 10 (correction loop) |
| ID gate: timeout → auto-approve | Task 10 (null check) |
| Step 3: eBay Apify sold comps | Task 6 |
| Step 3: SerpAPI cross-platform comps (luxury only) | Task 6 |
| Step 3: Insert `pricing_comps` rows | Task 6 |
| Step 3: Confidence score calculation | Task 6 |
| Step 3: Suggested price = median of adjusted comps | Task 6 |
| Step 4: Claude draft + PhotoRoom in parallel | Task 10 (`Promise.all`) |
| Step 4a: Canonical title, description, platform_fields | Task 7 |
| Step 4a: eBay 80-char keyword title | Task 7 |
| Step 4b: PhotoRoom background removal + white background | Task 8 |
| Step 4b: Store processed image in Supabase Storage | Task 8 |
| Step 5: Claude auth plan (luxury only) | Task 9 |
| Step 5: No referrals to Entrupy / Real Authentication | Task 9 |
| Step 5: eBay AG / Poshmark note for items ≥ $500 | Task 9 |
| Supabase Realtime push at each step (`pipeline_step` update) | Task 3 (`pushPipelineStep`) |
| Pipeline failure: `agent_blocked = true` with step name | Task 10 (`onFailure`) |
| Pipeline failure: listing enters `in_loop` | Task 10 (`onFailure`) |
| Retry-step handler for failed steps | Task 13 |
| Photo quality gate for studio uploads | Task 14 |
| Photo quality gate: Claude vision checks (blur, exposure, framing, multiple items) | Task 14 |
| Quality gate pass → PhotoRoom processing | Task 14 |
| Quality gate fail → flag photo, don't process | Task 14 |
| Intake photo upload route | Task 11 |
| Studio photo upload route | Task 11 |
| ID gate confirmation API route | Task 12 |
| Retry-step API route | Task 13 |

### Placeholder scan

No TBD, TODO, "implement later", or "similar to Task N" patterns. Every step has the actual code.

### Type consistency

- `Step1Result.ok: true` — used in `intake-pipeline.ts` directly (no `| Step1Error` in the function return since we throw on error instead)
- `Step2Result` interface — `runStep2VisionAnalysis` returns it; `runStep3PricingResearch`, `runStep4aDraftListing`, `runStep5AuthPlan` all accept it
- `retryStep` function: casts `step2Partial` to `Parameters<typeof runStep3PricingResearch>[1]` — works because the partial shape satisfies the subset needed
- `pushPipelineStep` accepts `[column: string]: unknown` — allows any listing field without union exhaustion
- `AuthStep` from `src/types/listings.ts` used in `step5-auth-plan.ts` — matches schema `auth_plan jsonb` column

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/02-intake-pipeline.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
→ Use `superpowers:subagent-driven-development`

**2. Inline Execution** — Execute tasks in this session using the executing-plans skill, batch execution with checkpoints
→ Use `superpowers:executing-plans`

Which approach?
