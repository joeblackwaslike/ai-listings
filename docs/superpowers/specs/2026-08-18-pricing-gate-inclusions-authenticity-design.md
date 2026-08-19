# Pricing gate: condition + inclusions confirmation, inclusion $ premiums, authenticity-threshold-aware pricing

**Bead:** ai-listings-yva (sub-project 3 of 3 of the pipeline-accuracy redesign; depends on ai-listings-e75 and ai-listings-kks, both merged)
**Status:** design approved, not yet planned/implemented

## Context

`step3-pricing-research.ts` gathers comps and computes `suggested_price_cents` immediately after intake — before studio photos exist, before condition is ever re-confirmed (ai-listings-e75), and before inclusions are ever confirmed (ai-listings-kks). Condition already adjusts comp prices ±15% (`conditionDelta`/`adjustForCondition`), but inclusions currently play no role in pricing at all.

Two problems this design must solve, found during research (not previously known):

1. **Condition staleness.** `condition-reassessment.ts` (triggered by studio-photo confirmation) flips `condition_confirmed: false` and recomputes `condition`, but never re-triggers step3 or the price. Nothing today refreshes the price after condition changes post-intake.
2. **`final_price_cents` is dead code.** `src/lib/platforms/unified-listing.ts:41-46` already has a `final_price_cents` column (schema since migration 0001) intended as the authoritative publish price, with an explicit "open question for Joe" comment noting nothing ever sets it — publish silently falls back to the raw, unadjusted `suggested_price_cents`. `auto-discount-cron.ts` also reads/writes this column post-publish. Any pricing-gate design that doesn't wire into this fallback chain is cosmetic — FieldsPanel would show a corrected number while eBay/Poshmark still get the old one.

## Architecture

One shared pure function, `computeAdjustedPricing(listing, comps, { includePremiums: boolean })`, in a new module `src/lib/pipeline/pricing-adjust.ts`. Replaces every place that currently treats `suggested_price_cents` as "the price."

- `conditionDelta` / `adjustForCondition` move out of `step3-pricing-research.ts` into this module. The function recomputes condition delta from each comp's stored raw `condition` text against the listing's **current** `condition` column — not the `condition_delta`/`adjusted_price_cents` values baked into `pricing_comps` rows at gather-time. This is what fixes the staleness gap: since the function always reads current state, there is nothing to invalidate or re-trigger.
- `includePremiums` distinguishes provisional (pre-confirmation: condition-adjusted median only, matches today's behavior) from final (post-confirmation: condition-adjusted median + inclusion premiums + authenticity premium). Same function, same code path both times — not two separate systems. Callers pass `includePremiums: listing.condition_confirmed && listing.inclusions.every(i => i.confirmed)` — this single boolean expression ("gate unlocked") is the one place the gate condition is expressed; the finalize route below uses the same expression for its 400/200 check, not a separate rule.
- Inclusion premiums and authenticity premium are computed off the base condition-adjusted median (pre-premium), so the premiums don't create a circular price-tier lookup.
- `computeAdjustedPricing` takes `comps` as a parameter — it does not fetch them itself. `FieldsPanel.tsx` already has `pricing_comps` in scope (passed to `EvidenceDrawer` today). `unified-listing.ts` and `auto-discount-cron.ts` do **not** currently query `pricing_comps` at all — both need a new `supabase.from('pricing_comps').select(...).eq('listing_id', ...)` query added before calling the function.

**Callers, replacing direct reads of `listing.suggested_price_cents`:**

| Caller | Before | After |
|---|---|---|
| `FieldsPanel.tsx` price display | `listing.suggested_price_cents` | `computeAdjustedPricing(listing, comps, { includePremiums: gateUnlocked })` |
| `unified-listing.ts:46` (eBay publish price) | `listing.final_price_cents ?? listing.suggested_price_cents ?? 0` | `listing.final_price_cents ?? computeAdjustedPricing(listing, comps, { includePremiums: true }) ?? 0` — resolves the existing open TODO |
| `auto-discount-cron.ts` `currentPrice` fallback | `listing.final_price_cents ?? listing.suggested_price_cents ?? 0` | same substitution as above |

`step3-pricing-research.ts` keeps writing `suggested_price_cents` unchanged (comps-only estimate, used for the initial `listing_price_events` seed row and the methodology text) — it becomes "what step3 first estimated," not the source of truth for display or publish.

`final_price_cents` keeps its existing meaning: an explicit override (auto-discount, or a future manual "edit price" UI) that always wins when present. Nothing new is persisted by this project — `computeAdjustedPricing` is genuinely on-demand.

## Inclusion item premiums

Price tiers are universal bands on the base condition-adjusted median, not per-category breakpoints: **LOW** (<$150), **MID** ($150–750), **HIGH** (>$750).

Keyed off the exact checklist item strings from `src/lib/inclusions.ts`'s `getInclusionChecklist`, excluding `"Authenticity card"` (handled by the authenticity premium below — excluded here to avoid double-counting). All figures below are illustrative starting constants, explicitly tunable, not sourced market data:

| Category | Item | LOW | MID | HIGH |
|---|---|---|---|---|
| handbag / small_leather_goods | Original box | $8 | $20 | $50 |
| | Dust bag/cover | $5 | $15 | $35 |
| | Shop bag | $3 | $8 | $15 |
| | Brand tag (attached) | $5 | $15 | $35 |
| | Brand tag (severed) | $2.50 | $7.50 | $17.50 |
| | Reseller tag/UPC | $3 | $8 | $15 |
| | Receipt | $3 | $5 | $10 |
| watches | Original box | $10 | $25 | $75 |
| | Dust bag/cover | $5 | $10 | $25 |
| | Warranty/registration card | $8 | $20 | $50 |
| | Instruction booklet | $5 | $10 | $20 |
| | Receipt | $5 | $8 | $15 |
| sneakers | Original box | $8 | $15 | $30 |
| | Dust bag/cover | $3 | $6 | $12 |
| | Extra shoelaces | $3 | $5 | $8 |
| | Brand tag (attached) | $5 | $10 | $20 |
| | Brand tag (severed) | $2.50 | $5 | $10 |
| | Shop bag | $3 | $5 | $10 |
| | Receipt | $2 | $4 | $8 |
| jewelry, electronics, clothing, keyboards, collectibles (BASE checklist only) | Original box | $3–5 | $8–15 | $15–40 |
| | Dust bag/cover | $2–3 | $4–8 | $8–20 |
| | Receipt | $2–3 | $3–5 | $5–10 |

Brand-tag premium is halved when `tagState === 'severed'`. Manually-added inclusions (`source: 'manual'`) whose free-text `item` doesn't match a checklist string get **$0** premium — avoids crediting arbitrary user text with an unearned amount; revisit once real conversion data exists.

**Explicitly descoped:** the "complete set" bonus (all expected items present together worth more than the sum) — file a follow-up bd ticket after this ships; do not implement in this iteration.

## Authenticity premium

Applies only when an `"Authenticity card"` inclusion is **confirmed**, using its `docSource` (`'original' | 'reseller' | 'third_party'`). Below the category's mandatory-auth threshold, a step-down dollar premium applies (hard cutoff, not a taper); at/above threshold, premium is $0 since eBay Authenticity Guarantee / Poshmark Posh Authenticate will authenticate the item independently regardless of the seller's own documentation:

| docSource | LOW | MID | HIGH |
|---|---|---|---|
| original | $5 | $20 | $50 |
| reseller | $3 | $10 | $25 |
| third_party | $2 | $6 | $15 |
| none / no confirmed auth card | $0 | $0 | $0 |

Thresholds (sourced in the ai-listings-yva ticket's 2026-08-17 brainstorm notes; using the more conservative of eBay/Poshmark's published figures since the app has no target-platform selection at pricing time):

| Category | Threshold |
|---|---|
| jewelry | $500 |
| sneakers | $75 |
| collectibles | $200 (trading-card figure, applied to the whole `collectibles` category as an approximation — flagged as a known imprecision; revisit if a `trading_cards` sub-type is ever split out) |
| handbag / small_leather_goods | $500 (Posh Authenticate, more conservative than eBay's ~$750 signature-required-delivery figure) |
| watches, electronics, clothing, keyboards (no documented mandatory-auth threshold) | none — premium always applies regardless of price |

## Finalize gate reconciliation

`src/app/api/listings/[id]/finalize/route.ts` — replace the INTERIM `if (!listing.condition_confirmed)` block with a single combined check:

```ts
if (!listing.condition_confirmed || inclusions.some((i) => !i.confirmed)) {
  return Response.json({ error: 'Confirm condition and all inclusions before finalizing.' }, { status: 400 })
}
```

This is a superset of the interim check, not a second gate alongside it — delete the INTERIM comment and the old logic entirely. No separate "confirm price" action or `pricing_confirmed` field is added; price stays informational, gated implicitly by condition + inclusions confirmation (per explicit decision — this is the ticket's acceptance criterion, and the decision is: **subsume/replace**, not coexist).

## FieldsPanel UI

Reuses the existing amber "pending confirmation" visual idiom (same styling as the condition/inclusions pending states):

- **Pre-confirmation:** price block shows the provisional condition-adjusted estimate (`includePremiums: false`) with an amber note: *"Provisional — will be refined once condition and inclusions are confirmed."*
- **Post-confirmation:** same block, now computed with `includePremiums: true`; amber note disappears. No before/after diff shown, just the number.
- No new confirmable field or button for price itself.

## Testing

`computeAdjustedPricing` is pure (comps + listing → number + breakdown) — unit-testable per TDD without touching the DB:

- Condition-delta recomputes correctly when `listing.condition` changes after comps were gathered (the staleness-fix case).
- Inclusion premium: correct tier lookup, severed-tag halving, unmatched free-text item → $0.
- Authenticity premium: below/at/above threshold cutoff, all four `docSource` states, categories with no documented threshold always apply.
- Finalize route: 400 when condition unconfirmed, 400 when any inclusion unconfirmed, 200 when both confirmed.
- `unified-listing.ts` and `auto-discount-cron.ts` fallback chains: `final_price_cents` override still wins when present; falls through to `computeAdjustedPricing` otherwise.

## Migration

None. `condition_confirmed`, `inclusions[].confirmed`, `docSource`, `tagState`, and `final_price_cents` all already exist in the schema. This ships as an application-logic-only change.
