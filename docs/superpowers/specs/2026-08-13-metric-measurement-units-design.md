# Metric Measurement Input + Dual-Unit Output — Design Spec

**Date:** 2026-08-13
**Status:** Approved
**Derived from:** design conversation 2026-08-14 (plan-mode brainstorm), bd issue `ai-listings-4zx`, deferred from `ai-listings-x9e` (gate-conversation-persistence)

---

## What This Builds

Joe's measuring tools are metric (cm/mm square, mm micrometer), but `MeasurementFields` only ever asks for inches, including fractional inches (e.g. `32.5`) — awkward to produce from a metric tool. This spec adds:

1. A per-user, settings-backed preference (`measurement_input_unit`: `'imperial' | 'metric'`) that switches `MeasurementFields`' numeric inputs to millimeters.
2. Dual-unit (`32 in (813 mm)`) formatting everywhere a measurement value is shown afterward: the workspace `FieldsPanel`, generated listing descriptions, and the persisted gender-gate conversation history (`synthesizeGenderGateAnswer`).

Stored values stay canonical inches — no schema change, no migration, no unit column. The mm input converts to inches before it's ever written to `Measurements`; every display surface converts inches → mm for the metric half of the dual-unit string. This keeps all existing stored data valid as-is and keeps `Measurements`/`MeasurementField` (`src/types/listings.ts`) unchanged.

**Done when:** with the preference set to metric, submitting a `gender_gate` measurement form accepts mm input and stores the correct inches value; `FieldsPanel` shows a new measurements section with dual-unit values for any listing that has them; a regenerated listing description mentions dual-unit measurements when the item has them; and the persisted gate conversation history shows dual-unit strings instead of bare numbers.

---

## Architecture

A new pure conversion module, `src/lib/units.ts`, is the single source of truth for mm↔inches conversion and dual-unit formatting. Every consumer (input form, `FieldsPanel`, description prompts, `gate-messages.ts`) imports from it rather than reimplementing rounding/formatting — mirroring how `gate-messages.ts` itself centralized gate-prompt text in the prior spec.

The preference follows the existing `auto_discount_enabled`-style precedent exactly: a new key in the generic `user_settings` table (migration `0004`), read/written through the existing `src/lib/user-settings.ts` helpers — no new table, no new migration.

`getMeasurementFields()` (`src/lib/utils.ts`) remains the single source of truth for which fields/labels apply per category/subtype; this spec only reorders its catch-all dimension bucket and does not change its per-category branching.

---

## File Map

| File | Create / Modify | Responsibility |
|------|-----------------|-----------------|
| `src/lib/units.ts` | Create | `mmToInches`, `inchesToMm`, `formatDualMeasurement` — pure functions |
| `src/lib/units.test.ts` | Create | Unit tests, `node --test` convention (matches `gate-messages.test.ts`) |
| `src/lib/utils.ts` | Modify | `getMeasurementFields()` catch-all bucket reordered to width, height, depth |
| `src/lib/user-settings.ts` | No change | Reused as-is (`getSetting`/`setSetting`/`getSettings`) |
| `src/app/settings/measurements/page.tsx` | Create | Server component: auth → `getSettings(user.id, ['measurement_input_unit'])` → default `'imperial'` |
| `src/app/api/settings/measurements/route.ts` | Create | `GET`/`PATCH`, mirrors `src/app/api/settings/auto-discount/route.ts` |
| `src/components/settings/MeasurementSettings.tsx` | Create | Client toggle component, mirrors `AutoDiscountSettings.tsx` |
| `src/app/settings/page.tsx` | Modify | Add a "Measurement Units" nav card |
| `src/app/listings/[id]/page.tsx` | Modify | Fetch `measurement_input_unit`, thread into `DetailGateContext`/`AgentChat`/`MeasurementFields` |
| `src/components/workspace/MeasurementFields.tsx` | Modify | New `inputUnit` prop; mm hint/step + `mmToInches` conversion on submit when metric |
| `src/components/workspace/FieldsPanel.tsx` | Modify | New measurements section (net new — none exists today) using `formatDualMeasurement` |
| `src/lib/pipeline/gate-messages.ts` | Modify | `synthesizeGenderGateAnswer` formats numeric fields via `formatDualMeasurement` |
| `src/lib/pipeline/gate-messages.test.ts` | Modify | Update fixtures for dual-unit synthesized answer strings |
| `src/lib/pipeline/step4a-draft-listing.ts` | Modify | Add `measurements, clothing_sub_type` to the Supabase `select()`; append a formatted measurements line to the prompt when populated |
| `src/lib/agent/tools.ts` | Modify | Same addition in `buildDescription()`'s `select()` and prompt |

---

## `units.ts` — Exports

```ts
mmToInches(mm: number): number
// mm / 25.4, rounded to 2 decimals — matches MeasurementFields' existing step="0.5" inch granularity

inchesToMm(inches: number): number
// inches * 25.4, rounded to nearest whole mm — micrometer-appropriate precision

formatDualMeasurement(inches: number): string
// `${inches} in (${inchesToMm(inches)} mm)`, e.g. "32 in (813 mm)"
```

Chip fields (`rise`: Low/Mid/High) are never numeric. Every call site that formats a `MeasurementField` value must check `field.useChips` first and pass the raw string through unconverted — `formatDualMeasurement` is only ever called with a numeric measurement value, never a chip label.

---

## Data Flow

**Settings (read path, e.g. `src/app/listings/[id]/page.tsx`)**

1. `createClient()` → `auth.getUser()`.
2. `getSettings(user.id, ['measurement_input_unit'])`, default to `'imperial'` if unset (matches the existing `DEFAULTS` pattern in `auto-discount/page.tsx`).
3. Pass `inputUnit` down through `DetailGateContext` construction into `AgentChat` → `MeasurementFields`.

**Settings (write path, `src/app/api/settings/measurements/route.ts`)**

- `GET`: auth + `getSettings` + default, returns JSON — mirrors `auto-discount/route.ts` `GET`.
- `PATCH`: auth + `setSetting(user.id, 'measurement_input_unit', value, 'string')` — mirrors `auto-discount/route.ts` `PATCH`.

**Measurement input (`MeasurementFields.tsx`)**

1. Component receives `inputUnit: 'imperial' | 'metric'` as a prop.
2. For numeric (non-chip) fields when `inputUnit === 'metric'`: hint text switches to mm-flavored copy (e.g. `"in mm (e.g. 813)"`), `step="1"`.
3. On submit (`handleSubmit`), each numeric field's raw entered value is run through `mmToInches()` before being placed into the `Partial<Measurements>` object — so `confirm-gender`'s payload, and everything downstream of it, is always inches regardless of which mode the user typed in.
4. Imperial mode is unchanged: `step="0.5"`, `parseFloat`, no conversion.

**Display — `FieldsPanel.tsx` (net new section)**

1. Reads `listing.measurements` and `getMeasurementFields(listing.category, listing.clothing_sub_type)` to know which keys/labels apply to this item.
2. For each field present in `listing.measurements`: chip fields render their raw string (e.g. `"Rise: Mid"`); numeric fields render `` `${label}: ${formatDualMeasurement(value)}` ``.
3. Section is omitted entirely if the listing has no populated measurement fields (e.g. sneakers' `us_size`, which formats as a bare number, not a measurement — `us_size` is intentionally excluded from dual-unit formatting).

**Display — `synthesizeGenderGateAnswer` (`gate-messages.ts`)**

- Existing `.map` over `detailGateContext.measurementFields` changes its per-field formatting from `String(measurements[field.key])` to: chip fields keep `String(...)`, numeric fields use `formatDualMeasurement(Number(measurements[field.key]))`. This is a **state** change, not just a render change — the synthesized string is what gets persisted into the `conversations` table per `ai-listings-x9e`, so `gate-messages.test.ts` fixtures must be updated to the new dual-unit strings.

**Display — listing description generation**

- `step4a-draft-listing.ts` and `agent/tools.ts`'s `buildDescription()` currently omit `measurements`/`clothing_sub_type` from their Supabase `select()` and prompts entirely (verified against current `origin/main` — this is genuinely net-new wiring, not a modification of existing measurement-aware logic).
- Both add `measurements, clothing_sub_type` to their `select()`.
- Both build a measurements line the same way `FieldsPanel` does (reusing `getMeasurementFields` + `formatDualMeasurement`), e.g. `Measurements: Waist: 32 in (813 mm), Inseam: 30 in (762 mm)`, appended to the prompt only when at least one field is populated — so items with no measurements see no change to their generated prompt.

---

## Error Handling

- `mmToInches`/`inchesToMm` are pure numeric functions — no error paths; `NaN`/invalid input handling stays exactly where it already lives today (`MeasurementFields.handleSubmit` already skips empty/undefined values before building the `Partial<Measurements>` object; this is unchanged).
- Settings `GET`/`PATCH` follow the auto-discount route's existing auth/error-handling shape verbatim — no new error cases introduced.
- If `getSettings` fails or the key is unset, default to `'imperial'` (today's only behavior) rather than throwing — a missing preference must never block the gate form from rendering.

---

## Testing

- Unit tests for `src/lib/units.ts`: `mmToInches`, `inchesToMm`, `formatDualMeasurement`, plus a round-trip check (mm → inches → mm) confirming drift stays within expected rounding (≤1mm).
- Update `gate-messages.test.ts` fixtures for the new dual-unit-formatted `synthesizeGenderGateAnswer` output (both the gender-only and gender+measurements cases already covered there).
- No new API-route test infrastructure — consistent with the prior gate-conversation-persistence spec's testing approach (this repo has no Supabase-mocking harness for routes yet — `ai-listings-8du`).
- Manual smoke test end-to-end (see Verification below), since the settings page, input-unit switch, and three display surfaces are all UI/behavior that unit tests can't fully cover.

---

## Verification

1. Set the preference to metric on `/settings/measurements`.
2. Submit a `gender_gate` measurement form using mm values; confirm the stored `listings.measurements` row contains sane inches values (spot-check via `psql`).
3. Reload the listing detail page — confirm `FieldsPanel` shows the new measurements section with dual-unit values.
4. Regenerate the listing description — confirm it mentions the dual-unit measurement line.
5. Confirm the persisted gate conversation history (from the `conversations` table / `AgentChat` scrollback) shows the dual-unit string, not a bare number.
6. `pnpm test`, `tsc --noEmit` clean.

---

## Explicitly Out of Scope

- **No schema change.** `Measurements`/`MeasurementField` (`src/types/listings.ts`) are unchanged — canonical-inches storage was chosen specifically to avoid touching them or needing a migration/backfill.
- **No narrowing of which categories get measurement fields.** A stale, uncommitted worktree (`feature/gender-measurements-r2`) explored dropping dimension fields for electronics/jewelry/collectibles/watches/keyboards down to just handbag/small_leather_goods — investigated and discarded (that branch predates the gender/measurements gate work that actually shipped). All 8 catch-all categories keep width/height/depth; only the order changes.
- **`sneakers`' `us_size` field is not measurement-unit-aware.** It's a shoe size number, not a physical dimension — excluded from `formatDualMeasurement` everywhere.
- **No live in-session echo of dual-unit measurements** during `MeasurementFields` submission itself — `AgentChat`'s live UI still just shows the static "Got it — running pricing research now..." acknowledgment (per `ai-listings-9ch`, tracked separately). This spec only changes what's *persisted* and what's shown on reload/elsewhere, not the live in-session chat bubble.
- **cm as an alternative metric unit.** The issue's literal ask is "mm instead of fractional inches" (matching Joe's mm micrometer/mm-square tools) — mm is used for every metric value, not cm, to avoid a second unit-choice ambiguity.
