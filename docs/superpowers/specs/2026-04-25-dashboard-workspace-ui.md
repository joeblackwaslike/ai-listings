# Dashboard + Workspace UI — Design Spec

**Date:** 2026-04-25
**Sub-plan:** 4 — Dashboard + Workspace UI
**Status:** Approved (autonomous — user unavailable for Q&A)
**Derived from:** `design-spec.md`, existing codebase

---

## What This Builds

Two pages that surface the listing inventory and per-listing workspace:

- **Dashboard** (`/dashboard`) — card grid with drag-and-drop photo upload and Supabase Realtime live updates
- **Workspace** (`/listings/[id]`) — split layout: left panel (photos, photo plan, inclusions, fields, auth checklist) + right panel (streaming agent chat with pricing evidence drawer)

**Done when:** Drop 3 photos → 3 cards appear live on the dashboard as they process.

---

## Packages Added

- `lucide-react` — icons (tree-shaken, React 19 compatible)
- `sonner` — toast notifications for upload results

No DnD library. Photo reorder deferred to P3 (no schema field to track failure state either — retry button deferred similarly).

---

## File Map

| File | Create / Modify | Responsibility |
|------|-----------------|---------------|
| `next.config.ts` | Modify | Add Supabase Storage remote image pattern |
| `src/app/layout.tsx` | Modify | Add `<Toaster />` from sonner |
| `src/lib/utils.ts` | Create | `formatPrice`, `relativeDate` helpers |
| `src/components/dashboard/StatusBadge.tsx` | Create | Status pill derived from listing fields |
| `src/components/dashboard/ListingCard.tsx` | Create | Card: photo, SKU, title, price, badge |
| `src/components/dashboard/UploadZone.tsx` | Create | Drag-and-drop → POST /api/upload |
| `src/components/dashboard/ListingsGrid.tsx` | Create | Client: state + Realtime subscription + grid |
| `src/app/dashboard/page.tsx` | Modify | Server: initial listings + cover photos fetch |
| `src/components/workspace/PhotoPanel.tsx` | Create | Photos grid, photo plan checklist, inclusions |
| `src/components/workspace/FieldsPanel.tsx` | Create | Listing fields display + confidence + auth summary |
| `src/components/workspace/EvidenceDrawer.tsx` | Create | Slide-over: pricing comps table |
| `src/components/workspace/AgentChat.tsx` | Create | SSE streaming chat, conversation history |
| `src/app/listings/[id]/page.tsx` | Modify | Server: fetch listing + photos + comps + history |

---

## Dashboard Strategy

**Initial load:** Server component fetches listings + one cover photo per listing (single query, group by listing_id, prefer processed over raw). Passed as props to `ListingsGrid`.

**Realtime:** Browser client (`src/lib/supabase/client.ts`) subscribes to `postgres_changes` on `listings`. INSERT → append card at top with no photo. UPDATE → merge fields into existing card. No subscription on `photos` table — photo updates show on next page load.

**Status badge priority** (one badge shown per card):
1. `intake`/`id_gate` status → "Processing" (gray spinner in photo area, no click-through)
2. `agent_blocked` → "Needs you" (orange)
3. `in_loop` → "Ready" (green)
4. `finalizing` → "Ready to publish" (blue)
5. `published` → "Published" (purple)
6. `archived` → "Archived" (muted)

---

## Workspace Strategy

**Server component** fetches: full listing, all photos (ordered by display_order), pricing comps (ordered by adjusted_price_cents), last 30 conversation turns.

**Layout:** Two-column on desktop (`lg:grid-cols-[3fr_2fr]`), stacked on mobile. Left panel scrolls independently; right panel (agent chat) is sticky-height with internal scroll.

**PhotoPanel:** Displays studio/processed photos first; falls back to intake. Click thumbnail to select main photo. Photo plan shows each shot with required indicator. Inclusions shown with check/cross per item.

**FieldsPanel:** Read-only display of brand, condition, title, suggested price, confidence score, auth checklist steps, pipeline progress. "View evidence" button opens EvidenceDrawer.

**EvidenceDrawer:** Fixed overlay (right side on desktop) listing each pricing comp: source badge, title truncated, actual condition label, condition delta (+/−$ adjusted), relative date, link. Confidence score shown at top.

**AgentChat:** Conversation history loaded from server; new turns appended live. Sends POST to `/api/agent/[listingId]`, parses SSE stream manually (`ReadableStream` + `TextDecoder`). Tool call events shown inline as `⚡ {toolName}...` / `✓ {toolName}`. Scrolls to bottom on new messages.

---

## Image Configuration

Supabase Storage URLs follow `https://{project-ref}.supabase.co/storage/v1/object/public/**`. Add as `remotePatterns` in `next.config.ts` using wildcard hostname `*.supabase.co`.

---

## Not In This Iteration

- **DnD photo reorder** — filed as P3 backlog ticket
- **Editable listing fields** — user edits via agent chat; direct field editing not in scope
- **Retry pipeline step button** — requires a `pipeline_failed_step` schema field not yet added; filed as P3 ticket
- **Photo plan upload status** — matching shot names to uploaded photos requires heuristics; display only for now
