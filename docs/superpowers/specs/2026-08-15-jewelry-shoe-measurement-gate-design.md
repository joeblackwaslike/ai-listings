# Jewelry & Shoe Sizing — Measurement Gate Design

**Date:** 2026-08-15
**Status:** Approved
**Derived from:** design conversation 2026-08-15, triggered while Joe was loading real jewelry/shoe inventory and hit the measurement gate's generic fallback fields

---

## What This Builds

The intake pipeline's measurement gate (`status: gender_gate`) exists for two reasons: disambiguating scale/identity when vision analysis alone can't reliably judge it from a photo, and informing shipping estimates (box size). Today it has real sub-type logic only for clothing (`ClothingSubType` + `detectClothingSubType`) and one special field for sneakers (`us_size`). Every other category — including jewelry — falls through to a generic Width/Height/Depth box-dimension form, which doesn't map to anything useful for a ring, bangle, or necklace.

Separately, sneaker/shoe sizing has its own accuracy problem: the size printed inside a shoe varies by brand and country of origin (Chanel, Gucci, Louis Vuitton, Louboutin, etc. often print only EU/Italian sizing, sometimes with brand-specific vanity offsets), so a raw "type the number on the tag" field produces wrong listings without a real conversion step.

This spec covers both, kept together because they share the same underlying pattern and were designed in the same pass — not because they're the same feature.

**Done when:**
- Jewelry rings, bangles, and necklaces show sub-type-appropriate fields instead of generic W/H/D.
- Shoe sizing captures what's actually printed on the tag and converts to a real US size via a sourced table, with brand-specific overrides where they matter.
- Both degrade gracefully: missing/unparseable data falls back to LLM-generated guidance, never an LLM-invented sizing fact.

---

## Shared Architecture

**Regex-first, LLM-fallback classification.** Every lightweight classifier in this design (jewelry sub-type, irregular-ring-style detection, necklace chain-length parsing) tries a cheap regex match against existing `notable_features` text first (same pattern as the existing `detectClothingSubType`). Only when regex returns no match does it fall back to a small LLM call using the same context already on hand. No changes to step2's vision-analysis prompt/tool schema are needed for jewelry — the vision model already volunteers sub-type and even attempts measurements (e.g. chain length) unprompted in free text; this design formalizes parsing what's already there rather than teaching the model something new.

**LLM generates guidance, never asserts sizing facts.** Everywhere an LLM is used as a fallback in this design — classifying an ambiguous sub-type, suggesting where to look for a stamped size, generating "can't find sizing" help text — its output is instructional or classificatory, never a source of truth for an actual measurement, conversion value, or size-table entry. All conversion tables and brand-quirk notes must come from verified reference sources, sourced explicitly during implementation, never fabricated or LLM-recalled. This was validated hard during design: a naive US-ring-size chart read against a real known-7.5 ring, measured at a single point (18.3mm, the ring's widest point), computed to ~US 8.2 — a ~0.7 size gap. A second single-point reading at the ring's narrowest point (16.5mm) computed to a clean US 6 — a ~1.5 size gap the other direction. The actual cause was measuring an asymmetric bypass-band ring at a single point at all; averaging the two readings (17.4mm) computed to ~US 7.1, within half a size of the true 7.5 — not a flaw in the chart. Getting fooled once by an unverified number is exactly the failure mode this principle exists to prevent.

**Known-value-first.** Wherever a directly-known value is available, prefer it over a derived one: a ring's inscribed size beats a measured diameter; a shoe tag that already shows US sizing beats a converted EU value. Derivation/conversion is always the fallback, never the primary path, when a direct answer is available.

---

## Feature 1: Jewelry Sub-Type Measurement Fields

### Sub-type detection

`detectJewelrySubType(notableFeatures: string[]): JewelrySubType | null` in `src/lib/utils.ts`, same shape as the existing `detectClothingSubType` (`src/lib/utils.ts:16-28`) — reads the "Model:" line, regex-matches against ring/bangle/bracelet/necklace/earrings/pendant/brooch keywords. Falls back to an LLM classification call (same `notable_features` context) when regex finds nothing. Confirmed reliable against real data: all 3 of Joe's actual jewelry listings (JW-0010/011/012) had unambiguous sub-type signal in their vision-generated "Model:" line without any prompting to produce it.

### Field selection

Extends `getMeasurementFields(category, subType)` (`src/lib/utils.ts:30-91`) with a `category === 'jewelry'` branch, switching on detected sub-type:

- **Ring** — gate copy leads with checking for an inscribed/stamped size inside the band (magnifying glass helps), framed honestly as "worth checking, often present on precious-metal pieces from major brands, but not universally reliable" — not oversold as a guaranteed source, since thin bands, resized rings, artisan pieces, and non-precious costume jewelry frequently aren't stamped or may be stamped wrong after resizing. Below that, an inner-diameter (mm) field as the objective fallback/cross-check. The ID field's instructions are conditional: a single reading for a plain round band; widest-point + narrowest-point (averaged) for anything vision analysis described in irregular/asymmetric terms (bypass, wrap, open band, etc.) — detected via the same regex-then-LLM-fallback pattern applied to style-descriptive language already present in `notable_features`.
- **Bangle** — inner diameter (mm) always requested. If the listing's brand has an entry in a `BANGLE_SIZE_LADDERS: Record<string, SizeEntry[]>` table, the measured ID snaps to the nearest official size and is shown as a suggested size for confirmation. No table entry for a brand → raw mm only, no size-snap (never LLM-guessed — a hallucinated conversion table is exactly the accuracy risk this design avoids elsewhere). Seeded with Hermès (62mm / 65mm / 70mm), validated during design against a real known Hermès Size 65 measuring 66.6mm — a 0.6mm gap, within normal tolerance.
- **Necklace** — no dedicated required field. Chain length is parsed out of `notable_features` via the same regex-then-LLM-fallback approach and **pre-filled** into the gate form for a one-tap confirm, rather than fully auto-skipped — this preserves the gate's original scale-disambiguation purpose while costing near-zero extra effort when parsing succeeds. Confirmed against real data: of Joe's 2 real necklace examples, only 1 (JW-0010, `"Chain length: approximately 16\""`) had a parseable numeric length; the other (JW-0011) only volunteered a qualitative `"Chain style: fine cable chain"` with no length value. The empty-input fallback is expected to be at least as common as the pre-fill path in practice, not the exception.
- **Bracelet / earrings / pendant / brooch / other** — stay on the existing generic W/H/D fallback. No real items of these sub-types have come through yet; extend the same lightweight way (parse first, add a field branch) whenever one actually does. Deliberately not designed ahead of real need.

---

## Feature 2: Shoe/Sneaker Sizing

### Capture

Manual gate field — enter exactly what's printed on the tag, as-is. No vision-analysis or photo changes: sizing isn't captured via a dedicated photo, and the existing single-photo-per-listing intake flow isn't being extended for this. If a US size is already printed on the tag (common — many brands print multiple systems together, e.g. "EU 39 · UK 6 · US 8.5"), that value is used directly and no conversion happens at all.

### Conversion

When no US value is directly on the tag: a generic EU/UK→US conversion table, gender-aware (reusing the gender value the gender-gate already captures for this category — men's and women's US scales differ), is the default. Brand-specific override tables — seeded with Chanel, Gucci, Louis Vuitton, and Louboutin, sourced from real reference data during implementation, never LLM-recalled — take precedence when a brand entry exists. No override for a brand → falls back to the generic conversion, flagged as lower-confidence.

### Brand-quirk notes

Brand table entries carry an optional `note` field documenting known, sourced sizing behavior (e.g. "Louboutin runs half a size small vs. standard EU conversion"). This is durable, factual brand knowledge — sourced the same way as the conversion numbers, not LLM-invented — with two uses: surfaced to Joe during the gate as a heads-up when sizing a shoe from that brand, and available to step4a's draft-listing generation to reference in the buyer-facing description copy (legitimately useful resale-listing content, not just internal tooling).

### "Can't find sizing" fallback

An explicit escape-hatch option in the gate for when there's genuinely no legible size marking anywhere on the item (distinct from "found EU, need US" — this is "found nothing at all"). Triggers LLM-generated **navigational guidance only** — e.g. "Chanel espadrilles usually stamp EU size only, inside the tongue near the heel — check there" — never an asserted sizing fact. Distinct in kind from the brand-quirk notes above: this is a one-off hint about where to look, not durable factual content.

---

## Data Model

No database schema changes. Both features store their captured/derived values as new keys inside the existing `measurements JSONB` column on `listings`, the same way clothing measurements already work — no new columns needed.

New static reference data (sourced during implementation, not fabricated): `BANGLE_SIZE_LADDERS`, a generic `SHOE_SIZE_CONVERSION` table, and `SHOE_BRAND_OVERRIDES` (brand tables with optional `note` fields). Likely location: `src/lib/sizing/` as new files, following this codebase's existing convention of colocating category-specific logic near `src/lib/utils.ts`'s existing `getMeasurementFields`/`detectClothingSubType`.

---

## Testing

- Unit tests for the regex parsers (`detectJewelrySubType`, chain-length parsing, irregular-ring-style detection) against real `notable_features` fixtures — JW-0010/011/012's actual vision-analysis output (already captured in production) are good starting fixtures.
- Every seeded conversion table (bangle ladder, shoe brand overrides) gets validated against at least one real known-size item before being trusted, the same way the Hermès bangle table was checked against Joe's real Size 65 measurement during design. This is a hard requirement, not a nice-to-have — the ring case showed a plausible-looking naive conversion producing a materially wrong result silently.
- No existing test coverage exists for `getMeasurementFields`/`detectClothingSubType` today; this is a reasonable place to add a first test file for that logic, not just the new jewelry/shoe branches.

---

## Explicitly Out of Scope (filed separately)

- **Weight capture for heavy items, with defer support** (`ai-listings-6wb`) — orthogonal to both features here (jewelry is always light; shoes weren't discussed as needing it). Needs its own trigger-condition and "skip now, resume later" design, since no such pattern exists in the gate today.
- **Studio photo-shoot upload path for existing listings** (`ai-listings-xc7`) — surfaced while discussing shoe-tag photo capture; today's `/api/upload` route always creates a new listing, which will block the studio photo-shoot pipeline step once a listing actually reaches it. Not yet reached in production as of this writing.
- **Migrate legacy Supabase-storage photo URLs to R2** (`ai-listings-nho`) — surfaced during an unrelated production-incident investigation the same day; unrelated to this design beyond sharing a "revisit when it actually matters" philosophy.
