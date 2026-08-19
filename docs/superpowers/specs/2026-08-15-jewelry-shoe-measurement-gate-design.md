# Measurement Gate & Shipping Lifecycle — Jewelry, Shoes, Box/Weight Deferral, Finalizing Gate

**Date:** 2026-08-15
**Status:** Approved
**Derived from:** design conversation 2026-08-15, triggered while Joe was loading real jewelry/shoe inventory and hit the measurement gate's generic fallback fields. Scope grew during the same conversation from "jewelry + shoe fields" to the full measurement-collection lifecycle after Joe raised the "measure what?" ambiguity problem and the shipping-box-size question.

---

## What This Builds

The intake pipeline's measurement gate (`status: gender_gate`) exists for two reasons: disambiguating scale/identity when vision analysis alone can't reliably judge it from a photo, and informing shipping estimates (box size). Today it has real sub-type logic only for clothing (`ClothingSubType` + `detectClothingSubType`) and one special field for sneakers (`us_size`). Every other category — including jewelry — falls through to a generic Width/Height/Depth box-dimension form, which doesn't map to anything useful for a ring, bangle, or necklace.

Separately, sneaker/shoe sizing has its own accuracy problem: the size printed inside a shoe varies by brand and country of origin (Chanel, Gucci, Louis Vuitton, Louboutin, etc. often print only EU/Italian sizing, sometimes with brand-specific vanity offsets), so a raw "type the number on the tag" field produces wrong listings without a real conversion step.

Beyond fields, the gate has three structural problems this spec also addresses:

1. **Ambiguous copy.** "L×W×H" alone doesn't say what to measure — one shoe or the pair? The item or its box? Joe hit this directly with both jewelry ("not sure what to measure") and shoes ("did measurement refer to one or both sneakers? I measured one").
2. **No shipping-box concept.** Nothing today distinguishes "the item's own dimensions" from "the box it'll ship in," and nothing computes one from the other.
3. **Everything is collected at once, at one blocking gate**, regardless of whether it's actually needed yet. Shipping-only data (box dims, weight) doesn't need to block intake — it needs to exist somewhere before you actually list the item.

**Done when:**
- Jewelry rings, bangles, and necklaces show sub-type-appropriate fields instead of generic W/H/D.
- Shoe sizing captures what's actually printed on the tag and converts to a real US size via a sourced table, with brand-specific overrides where they matter.
- Both degrade gracefully: missing/unparseable data falls back to LLM-generated guidance, never an LLM-invented sizing fact.
- Every measurement prompt says unambiguously what to measure (single item vs. pair, item vs. box).
- Shoes and every other category have a real "estimated shipping box size," computed from item dims or taken directly from the real box when included.
- Shipping-only measurements (box, weight) never block the intake pipeline, and have a real place to be filled in later.
- `finalizing` becomes a real, reachable status with an actual checklist, instead of dead code with a label and no way to reach it.

---

## Shared Architecture

**Regex-first, LLM-fallback classification.** Every lightweight classifier in this design (jewelry sub-type, irregular-ring-style detection, necklace chain-length parsing) tries a cheap regex match against existing `notable_features` text first (same pattern as the existing `detectClothingSubType`). Only when regex returns no match does it fall back to a small LLM call using the same context already on hand. No changes to step2's vision-analysis prompt/tool schema are needed for jewelry — the vision model already volunteers sub-type and even attempts measurements (e.g. chain length) unprompted in free text; this design formalizes parsing what's already there rather than teaching the model something new.

**LLM generates guidance, never asserts sizing facts.** Everywhere an LLM is used as a fallback in this design — classifying an ambiguous sub-type, suggesting where to look for a stamped size, generating "can't find sizing" help text — its output is instructional or classificatory, never a source of truth for an actual measurement, conversion value, or size-table entry. All conversion tables and brand-quirk notes must come from verified reference sources, sourced explicitly, never fabricated or LLM-recalled. This was validated hard during design: a naive US-ring-size chart read against a real known-7.5 ring, measured at a single point (18.3mm, the ring's widest point), computed to ~US 8.2 — a ~0.7 size gap. A second single-point reading at the ring's narrowest point (16.5mm) computed to a clean US 6 — a ~1.5 size gap the other direction. The actual cause was measuring an asymmetric bypass-band ring at a single point at all; averaging the two readings (17.4mm) computed to ~US 7.1, within half a size of the true 7.5 — not a flaw in the chart. Getting fooled once by an unverified number is exactly the failure mode this principle exists to prevent.

**Known-value-first.** Wherever a directly-known value is available, prefer it over a derived one: a ring's inscribed size beats a measured diameter; a shoe tag that already shows US sizing beats a converted EU value. Derivation/conversion is always the fallback, never the primary path, when a direct answer is available.

**Disambiguating copy, everywhere a measurement is asked for.** Every measurement field's gate copy must state explicitly what it refers to, not just its name: whether it's one item or a set/pair, whether it includes packaging or not, and which physical dimension is which (e.g. "Length: toe to heel" not just "Length"). This applies retroactively to existing fields, not just the new ones in this spec — the ambiguity isn't jewelry- or shoe-specific, it's a property of unlabeled numeric fields in general. Concretely: shoe/sneaker item dimensions are captured for **one shoe of the pair**, and the gate copy says so explicitly, because the pair-vs-single question is exactly what caused real confusion during this design (see Shipping Measurements below for how the pair is reconstructed for box-size purposes).

---

## Feature 1: Jewelry Sub-Type Measurement Fields

### Sub-type detection

`detectJewelrySubType(notableFeatures: string[]): JewelrySubType | null` in `src/lib/utils.ts`, same shape as the existing `detectClothingSubType` (`src/lib/utils.ts:18-30`) — reads the "Model:" line, regex-matches against ring/bangle/bracelet/necklace/earrings/pendant/brooch keywords. Falls back to an LLM classification call (same `notable_features` context) when regex finds nothing. Confirmed reliable against real data: all 3 of Joe's actual jewelry listings (JW-0010/011/012) had unambiguous sub-type signal in their vision-generated "Model:" line without any prompting to produce it.

### Field selection

Extends `getMeasurementFields(category, subType)` (`src/lib/utils.ts:32-93`) with a `category === 'jewelry'` branch, switching on detected sub-type:

- **Ring** — gate copy leads with checking for an inscribed/stamped size inside the band (magnifying glass helps), framed honestly as "worth checking, often present on precious-metal pieces from major brands, but not universally reliable" — not oversold as a guaranteed source, since thin bands, resized rings, artisan pieces, and non-precious costume jewelry frequently aren't stamped or may be stamped wrong after resizing. Below that, an inner-diameter (mm) field as the objective fallback/cross-check. The ID field's instructions are conditional: a single reading for a plain round band; widest-point + narrowest-point (averaged) for anything vision analysis described in irregular/asymmetric terms (bypass, wrap, open band, etc.) — detected via the same regex-then-LLM-fallback pattern applied to style-descriptive language already present in `notable_features`.
- **Bangle** — inner diameter (mm) always requested. If the listing's brand has an entry in a `BANGLE_SIZE_LADDERS: Record<string, SizeEntry[]>` table, the measured ID snaps to the nearest official size and is shown as a suggested size for confirmation. No seeded table entry for a brand → attempt to source one during implementation (don't stop at Hermès just because it's the validated case); only fall back to raw mm with no size-snap when no ladder can reasonably be sourced for that brand (never LLM-guessed — a hallucinated conversion table is exactly the accuracy risk this design avoids elsewhere). Seeded with Hermès (62mm / 65mm / 70mm), validated during design against a real known Hermès Size 65 measuring 66.6mm — a 0.6mm gap, within normal tolerance.
- **Necklace** — no dedicated required field. Chain length is parsed out of `notable_features` via the same regex-then-LLM-fallback approach and **pre-filled** into the gate form for a one-tap confirm, rather than fully auto-skipped — this preserves the gate's original scale-disambiguation purpose while costing near-zero extra effort when parsing succeeds. Confirmed against real data: of Joe's 2 real necklace examples, only 1 (JW-0010, `"Chain length: approximately 16\""`) had a parseable numeric length; the other (JW-0011) only volunteered a qualitative `"Chain style: fine cable chain"` with no length value. The empty-input fallback is expected to be at least as common as the pre-fill path in practice, not the exception.
- **Bracelet / earrings / pendant / brooch / other** — stay on the existing generic W/H/D fallback. No real items of these sub-types have come through yet; extend the same lightweight way (parse first, add a field branch) whenever one actually does. Deliberately not designed ahead of real need.

---

## Feature 2: Shoe/Sneaker Sizing

### Capture

Manual gate field — enter exactly what's printed on the tag, as-is. No vision-analysis or photo changes: sizing isn't captured via a dedicated photo, and the existing single-photo-per-listing intake flow isn't being extended for this. If a US size is already printed on the tag (common — many brands print multiple systems together, e.g. "EU 39 · UK 6 · US 8.5"), that value is used directly and no conversion happens at all. UI is a system picker (EU/UK/US/brand-specific) followed by a size input anchored to the chosen system — preselected based on the listing's brand when a brand-specific system applies, otherwise the user picks. Brand-specific sizing systems are selectable when applicable (e.g. a brand with known vanity sizing that doesn't map cleanly to standard EU).

### Conversion

When no US value is directly on the tag: a generic EU/UK→US conversion table, gender-aware (reusing the gender value the gender-gate already captures for this category — men's and women's US scales differ), is the default. Brand-specific override tables — seeded with Chanel, Gucci, Louis Vuitton, and Louboutin, sourced from real reference data during implementation, never LLM-recalled — take precedence when a brand entry exists. No override for a brand → falls back to the generic conversion, flagged as lower-confidence.

### Brand-quirk notes

Brand table entries carry an optional `note` field documenting known, sourced sizing behavior (e.g. "Louboutin runs half a size small vs. standard EU conversion"). This is durable, factual brand knowledge — sourced the same way as the conversion numbers, not LLM-invented — used by step4a's draft-listing generation to reference in the buyer-facing description copy when generating the sizing table (see "Sizing Data in Listing Generation" below).

### "Can't find sizing" fallback

An explicit escape-hatch option in the gate for when there's genuinely no legible size marking anywhere on the item (distinct from "found EU, need US" — this is "found nothing at all"). Triggers LLM-generated **navigational guidance only** — e.g. "Chanel espadrilles usually stamp EU size only, inside the tongue near the heel — check there" — never an asserted sizing fact. Distinct in kind from the brand-quirk notes above: this is a one-off hint about where to look, not durable factual content.

---

## Feature 3: Shipping Measurements

Distinct from identity/sizing measurements above: this is data whose only purpose is estimating what it costs to ship the item, and it is captured and computed independently of the identity-gate flow (see "Deferred Collection" below for why and how).

### Item dimensions

L×W×H, explicitly labeled per-field so there's no ambiguity about what's being measured (per the Shared Architecture disambiguation principle): Length = longest edge (e.g. toe-to-heel for shoes), Width = side-to-side at the widest point, Height = base to top. Every category that doesn't already have sub-type-specific fields gets this via the existing generic W/H/D fallback — already true today. Shoes are the one category that needs it added on top of the size table, since `us_size` alone gives no physical dimensions at all today. For shoes specifically, the item-dimension fields measure **one shoe of the pair**, with gate copy saying so explicitly — this is the exact ambiguity Joe hit directly ("did I measure one shoe or both? I measured one").

### Estimated shipping box (computed, not asked for directly)

The value actually needed is a package size to hand to eBay/other platforms' own shipping-cost calculators — this design produces that number, it does not calculate shipping cost itself (no carrier-rate integration).

- **Default (no packaging measured):** `boxDim = itemDim + (2 × PADDING_IN)` per dimension, with `PADDING_IN = 2` (i.e. 4in added per dimension total) as the starting constant — a reasonable estimate for bubble wrap/paper plus box-wall clearance, not sourced from a carrier spec since none applies here (this is a packing-material estimate, not a regulated conversion table like the ring/bangle/shoe charts). Same constant across every category, not category-tuned; treat as adjustable once real packages get compared against it, not as a validated fact the way the sourced tables elsewhere in this spec are.
- **Shoes specifically:** the pair's combined footprint is computed *before* padding, since the box has to fit both shoes, not one: `{ length: item.length, width: item.width × 2, height: item.height }` (two shoes side-by-side, sharing length and height, width doubles) — then the flat padding constant is applied on top of that.
- **If the original box is included and measured** (via the finalizing-gate checklist, see Feature 4): the measured box dimensions are used directly instead of the computed estimate. No padding math — real dimensions are known-value-first, same principle as the rest of this design.

### Weight

Captured the same deferred way as box dimensions (see Feature 4), gated on category — the heavy-item categories from `ai-listings-6wb`: handbags, watches, heavier collectibles/electronics/keyboards. Never asked for jewelry or shoes (always light enough not to matter). This spec absorbs `ai-listings-6wb` in full — that ticket should be closed with a pointer to this spec once implemented, rather than tracked separately.

### Deferred collection — why this isn't asked at the identity gate

None of Feature 3's fields block anything downstream today: `step3-pricing-research` only consumes `gender`, never raw `measurements`. Shipping-only data has no reason to sit on the same blocking checkpoint as identity-disambiguating fields (ring size, shoe size, sub-type). So:

- Box dimensions and weight are **never shown at the `gender_gate` screen at all** — full decoupling, not an optional-field compromise.
- They're surfaced later via the resurrected `finalizing` gate (Feature 4), which is also where they become editable for the first time (see Feature 4 — no edit path for `measurements` exists anywhere in the app today).
- Item dimensions (shoes' new field, and other categories' existing generic W/H/D) stay at the identity gate as today, since they're part of the same "can't tell scale from a photo" problem the gate already solves — they're not shipping-only, they double as the input to the box-size computation above.

---

## Feature 4: Finalizing Gate (resurrected)

`finalizing` exists in `ListingStatus` today but is dead: nothing in the pipeline transitions a listing into it, and the publish flow (`PATCH /api/listings/[id]/publish`) works directly from `in_loop`. It was originally scoped (per `docs/superpowers/specs/2026-04-25-publish-export.md`) as an "SEO gate" that was never wired — unrelated to shipping, but the status itself is being reused here rather than adding a second, would-be-redundant status.

- **Trigger:** an explicit "Finalize" action on an `in_loop` listing — not automatic, not tied to any pipeline step. Sets `status: 'finalizing'`.
- **Checklist (non-blocking):** matches this codebase's existing convention (`publish/route.ts`'s title-length check already warns without blocking, not a hard gate). Shown items:
  - **Shipping measurements** — box L×W×H, shown as needed only when `inclusions` has an included "original box" item and no box measurement is stored yet; weight, shown as needed only when category is in the heavy-item set and none is stored yet. Both fillable inline via a new editable-measurements UI (see Data Model).
  - **Title length** — the existing eBay (80 char) / Poshmark (60 char) limit check, surfaced here in addition to at publish time.
- **Publish is reachable from either `in_loop` or `finalizing`** — finalizing is a checkpoint you can pass through on the way to publishing, not a hard prerequisite. This preserves "never block on shipping info," including for listings Joe chooses to publish without ever visiting the finalizing screen.
- Nothing about the existing `in_loop` → `published` transition changes; `finalizing` is additive.

---

## Sizing Data in Listing Generation (step4a)

Two real gaps exist between what earlier drafts of this spec assumed and what `step4a-draft-listing.ts` actually does today — found by checking the file directly rather than assuming:

- **Jewelry sub-type won't reach the description at all without this fix.** `step4a` calls `getMeasurementFields(category, clothing_sub_type)`, and `clothing_sub_type` is meant to be a small, cheap, pre-computed lookup column (mirroring how it's already read in `FieldsPanel.tsx` and `agent/tools.ts`) rather than re-running detection at every read site. See Data Model below for the fix — this also happens to fix a pre-existing, unrelated bug (see next section).
- **No "sizing table" mechanism exists anywhere today, for anything.** `step4a`'s prompt currently gets one flat line — `Measurements: Label: value, Label: value` — pulled from the `measurements` JSONB. Shoes need more than that: a full multi-system comparison (e.g. "EU 39 · UK 6 · US 8.5") plus the brand-quirk note when one exists, both woven into the buyer-facing description. This requires passing the full conversion row (not just the resolved US value) and the matched brand-table `note` field into step4a's prompt as new inputs, and instructing the model to render them as a small sizing table plus a natural-language quirk sentence when present — the LLM's role here is formatting/prose only, not deciding the numbers (consistent with "LLM generates guidance, never asserts sizing facts").

---

## Data Model

**This is a real schema change** — unlike earlier drafts of this spec, "no database changes" is no longer accurate.

- **`clothing_sub_type` → `sub_type` (rename + actually wire it up).** While tracing how jewelry sub-type would reach `step4a`, found that `clothing_sub_type` — despite being read in four places (`step4a-draft-listing.ts`, `FieldsPanel.tsx`, `agent/tools.ts`, `gate-messages.ts`) — is **never written anywhere in the codebase**. Confirmed against the live DB: 1 of 108 listings has a non-null value. This spec both renames the column to the shared `sub_type TEXT` (typed in the app as `ClothingSubType | JewelrySubType | null`, discriminated together with `category`) and fixes the actual gap: the `store-gender` step in `intake-pipeline.ts` (which already writes `gender`/`measurements` on gate confirmation) is extended to also compute and write `sub_type` server-side via `detectClothingSubType`/`detectJewelrySubType` (whichever applies to the listing's category), rather than trusting a client-submitted value. A one-time backfill migration re-derives `sub_type` for existing listings from their stored `notable_features`, since the detection is cheap and deterministic.
- **New `measurements` JSONB keys:** item L×W×H (shoes), `estimated_shipping_box` (computed, all categories), box L×W×H (real, when box included), weight. Same column, no new tables — matches how clothing measurements already work.
- **New static reference data** (sourced during implementation, not fabricated): `BANGLE_SIZE_LADDERS`, `SHOE_SIZE_CONVERSION`, `SHOE_BRAND_OVERRIDES` (with optional `note` fields), and the flat shipping-padding constant. Likely location: `src/lib/sizing/`, following this codebase's existing convention of colocating category-specific logic near `src/lib/utils.ts`'s `getMeasurementFields`/`detectClothingSubType`.
- **New editable-measurements capability.** No edit path for `measurements` exists anywhere today (`FieldsPanel.tsx` renders it read-only; only `inclusions` has an edit path, via `PATCH /api/listings/[id]/inclusions`). This spec adds a mirrored `PATCH /api/listings/[id]/measurements` route and an editable section in `FieldsPanel`/the finalizing checklist — the first time any measurement becomes editable after the identity gate closes.
- **`finalizing` becomes a real, reachable `ListingStatus` value** — no type change needed (it already exists), just a real code path that sets it.

---

## Testing

- Unit tests for the regex parsers (`detectJewelrySubType`, chain-length parsing, irregular-ring-style detection) against real `notable_features` fixtures — JW-0010/011/012's actual vision-analysis output (already captured in production) are good starting fixtures.
- Every seeded conversion table (bangle ladder, shoe brand overrides) gets validated against at least one real known-size item before being trusted, the same way the Hermès bangle table was checked against Joe's real Size 65 measurement during design. This is a hard requirement, not a nice-to-have — the ring case showed a plausible-looking naive conversion producing a materially wrong result silently.
- No existing test coverage exists for `getMeasurementFields`/`detectClothingSubType` today; this is a reasonable place to add a first test file for that logic, not just the new jewelry/shoe branches.
- Shipping-box computation: unit tests for the flat-padding formula and the shoe pair-doubling adjustment specifically, since that's the one piece of this spec that's a real formula rather than a lookup.
- The `sub_type` backfill migration should be validated against real production `notable_features` data (all 108 existing listings) before being trusted, given it's now inferring a fact that today is silently always null.

---

## Explicitly Out of Scope (filed separately)

- **Studio photo-shoot upload path for existing listings** (`ai-listings-xc7`) — surfaced while discussing shoe-tag photo capture; today's `/api/upload` route always creates a new listing, which will block the studio photo-shoot pipeline step once a listing actually reaches it. Not yet reached in production as of this writing.
- **Migrate legacy Supabase-storage photo URLs to R2** (`ai-listings-nho`) — surfaced during an unrelated production-incident investigation the same day; unrelated to this design beyond sharing a "revisit when it actually matters" philosophy.
- **Actual shipping-cost calculation / carrier-rate integration** — explicitly not needed. eBay and other platforms compute shipping cost themselves from the package dimensions this design produces; no carrier API integration is in scope.
- **eBay/platform auto-fill of package dimensions** — no live integration exists yet that could consume `estimated_shipping_box` automatically (the eBay auto-post work is separate, in-progress elsewhere). This spec makes the number available in `measurements`; wiring it into an actual platform publish payload is future work once that integration exists.

`ai-listings-6wb` (weight capture with defer support) is **no longer out of scope** — it's fully absorbed into Feature 3/Feature 4 above and should be closed with a pointer to this spec once implemented.
