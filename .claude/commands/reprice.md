---
description: Manual pricing research on low-confidence/thin-comp listings, with the discipline this workflow requires
---

# Manual Repricing

Research and (when justified) correct prices for listings the automated pipeline priced with low confidence or thin comp data. Codified 2026-08-25 after a session where every one of the rules below was skipped at least once and had to be caught and fixed after the fact.

## 0. Scope the batch

```sql
select l.sku, l.title, l.suggested_price_cents/100.0 as ai_price, l.final_price_cents/100.0 as final_price,
       l.confidence_score, count(pc.id) as comp_count, l.agent_blocked, l.status
from listings l
left join pricing_comps pc on pc.listing_id = l.id and pc.source not like '%retail%'
where l.suggested_price_cents is not null
  and l.status != 'archived'          -- ALWAYS filter this. Archived items are not for sale.
  and l.agent_blocked = false          -- never touch a blocked item (e.g. suspected-counterfeit holds) without an explicit go-ahead
group by l.id, l.sku, l.title, l.suggested_price_cents, l.final_price_cents, l.confidence_score, l.agent_blocked, l.status
having l.confidence_score < 50 or count(pc.id) < 3
order by l.confidence_score asc nulls first, comp_count asc;
```

Batch size: ~4-6 items at a time. Present the batch list before starting research.

## 1. Per item, in this order

**a. Check `item_specifics` and any `Model` field FIRST.** The vision-analysis/product-ID pipeline step often already identified specific model names (e.g. "Stellar / Punchy" for an LV sneaker boot) — search those exact names before falling back to generic title-based search terms. Skipping this wastes a research pass.

**b. Audit the EXISTING comps before adding new research.** Pull every comp already on the listing and check each title against the item's own stated color/colorway/pattern/size/model — not just brand+category. This is not optional and not a one-time thing done for the first item in a batch — do it for every single item, every batch. A pipeline comp match on brand+category alone can produce comp sets that are entirely the wrong variant (this has happened with an entire 27-comp set being for a completely different colorway). Delete confirmed wrong-variant/wrong-color/wrong-size comps. If that leaves zero valid comps, say so plainly — don't leave a price looking better-supported than it is.

**c. Go deep by default — every item, not just the first one.** Multi-platform: eBay-scoped search AND at least one other resale platform (Fashionphile, TheRealReal, or a category-appropriate alternative — e.g. Reverb for electronics). Try a direct WebFetch on a specific listing for a hard price where feasible. Note: eBay item pages block direct WebFetch (times out, bot protection) — don't burn time retrying it. Fashionphile pages fetch fine but often hide price behind a JS placeholder on sold-out listings — a fetch attempt is still worth one try, just don't chase it further if it comes back empty.

**d. If a physical/visual concern comes up (item seems mislabeled, condition notes seem wrong, style doesn't match anything findable) — check the actual intake photo before concluding anything.** Download it, view it, compare against the title/condition_notes/item_specifics. This resolves most "is this mislabeled" questions faster and more reliably than more web search.

## 2. Apply the pricing formula — every item, every batch, no exceptions

1. Identify whether a genuinely *comparable* (same style, same material/tier, same color) active listing exists on any platform, from either the freshly-audited existing comps or new research.
2. If yes: price the item slightly below that real floor.
3. If no genuine comparable floor exists: discount-only path — take a researched low-estimate for the item, multiply by 0.85 (the standing "price to move" discount), and state explicitly that this is the no-floor branch. Don't silently skip the discount step.
4. Round down $1 if the result lands on a suspiciously round/whole-dollar figure (whole hundreds, clean $X50/$X00 marks) — this rule does NOT apply to every multiple of $10, only genuinely round-looking numbers.
5. State which branch was used (floor-anchored vs discount-only) in the methodology text.

This formula was defined carefully in the first batch of a session and then quietly abandoned for three subsequent batches until the user caught it. It applies to every item, every batch, for the whole session — not just the first one.

## 3. Backfill — every item, every batch, whether the price changed or not

For every item touched:
- **`pricing_comps`**: insert the real comp(s) that justified the decision (source, price, URL if verifiable, relevance_score). Mark unverified comps clearly in the title text itself (e.g. "unverified -- no direct listing link") rather than fabricating a URL. Never insert a comp with a guessed/unconfirmed URL.
- **`pricing_methodology`**: replace the stale auto-generated text (the old "median adjusted price... speed-to-sell price..." boilerplate) with a plain-language explanation of what was found and why the price changed or held. This applies even to a "no change" decision — write why, don't leave the old text in place.

Use a REPLACE, not an APPEND, when rewriting methodology — appending a note to old stale text produces confusing output (stale claim first, correction buried at the end).

## 4. Present for approval before writing anything

Show the computed table (item, current price, proposed price, reasoning) and wait for explicit approval before running `UPDATE` statements — unless the user has already pre-approved the batch pattern for the session.

## 5. Verify before declaring a batch done

After each batch, spot-check:
- Does every touched item's `pricing_methodology` start with today's date and NOT match the old auto-generated pattern?
- Does every price-changed item have at least one comp with `provider = 'manual'` (or an explicit "no comp exists" note in the methodology)?
- Did the existing-comp audit (step 1b) actually happen for every item, not just get skipped because "it seemed fine"?

If any of these are "no," fix it before moving to the next batch — don't let it accumulate for a later catch-up pass.
