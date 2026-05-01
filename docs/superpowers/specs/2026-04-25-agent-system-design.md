# Agent System Design

**Date:** 2026-04-25
**Sub-plan:** 3 — Agent System
**Status:** Approved (autonomous — user unavailable for Q&A)
**Derived from:** `design-spec.md`, `thick-tools-pattern.md`, `types/listings.ts`

---

## What This Builds

A streaming conversational AI agent scoped to a single listing. The agent has access to 6 thick tools that read from and write to Supabase. The system prompt + brand knowledge is cache-anchored to minimize Claude API cost. Each session persists turns to the `conversations` table.

**Done when:** POST `/api/agent/:listingId` with `{ message: "what should I price this at?" }` returns a streaming SSE response with real comp data.

---

## File Map

| File | Responsibility |
|------|---------------|
| `skills/agent-skills.md` | Brand/category knowledge — full flat file, ~600 lines |
| `src/lib/agent/system-prompt.ts` | System prompt string + `assembleContext()` — builds cache-optimized message array |
| `src/lib/agent/tools.ts` | 6 tool implementations + Anthropic JSON schemas + executor dispatch |
| `src/lib/agent/chat.ts` | `streamAgentResponse()` — agentic loop, handles multi-turn tool use, emits SSE events |
| `src/app/api/agent/[listingId]/route.ts` | POST (chat) + GET (conversation history) |

---

## Context Assembly

Order is fixed; cache-stable content anchors at the front.

```
system array (supports cache_control per block):
  [0] System prompt text         cache_control: ephemeral  ← cache anchor 1
  [1] agent-skills.md content    cache_control: ephemeral  ← cache anchor 2
  [2] Listing snapshot           cache_control: ephemeral  ← cache anchor 3

messages array:
  [...last 20 turns from conversations table]
  { role: 'user', content: userMessage }
```

Cache hit rate is highest for [0] and [1] (never change within a session). [2] changes when `update_listing` is called. History has no cache — it appends every turn.

**Listing snapshot** is a compact JSON string (~300 tokens):
- id, sku, status, brand, category, condition, suggested_price_cents, confidence_score
- title, description (truncated to 200 chars)
- photo_plan length, auth_plan length, inclusions length
- pipeline_step / pipeline_total
- agent_blocked, agent_blocked_reason

---

## Streaming Protocol

Response: `Content-Type: text/event-stream`, `Cache-Control: no-cache`

Each line: `data: {json}\n\n`

Event shapes:
```typescript
{ type: 'text';        content: string }         // streaming text chunk
{ type: 'tool_call';   name: string }             // tool executing (show spinner)
{ type: 'tool_result'; name: string; ok: boolean }// tool done
{ type: 'done' }                                  // stream closed
{ type: 'error';       message: string }          // unrecoverable error
```

The client can render tool_call/tool_result inline: `⚡ Researching pricing...`

---

## Agentic Loop

The loop runs until `stop_reason === 'end_turn'` or no tool_use blocks in response.

```
1. stream Claude response
2. collect tool_use blocks + text deltas (emit text events in real-time)
3. if stop_reason === 'tool_use':
   a. for each tool: execute, emit tool_call/tool_result events
   b. append { role: 'assistant', content: fullContent } to messages
   c. append { role: 'user', content: toolResults[] } to messages
   d. go to 1
4. save final assistant text to conversations table
5. emit done
```

Max iterations: 10 (guard against runaway loops). If exceeded, emit error event.

---

## Tools

All tools take `listingId` (always available from route params) plus optional narrow params. Return types already defined in `src/types/listings.ts`.

### `research_pricing`
- Input: `{ listingId: string }`
- Reads: `pricing_comps` rows for listing
- Computes: weighted median of `adjusted_price_cents`, confidence label, evidence string
- Returns: `PricingResearch | AgentToolError`
- Does NOT persist. Does NOT call SerpAPI (comps from pipeline are current).

### `get_auth_checklist`
- Input: `{ listingId: string }`
- Reads: listing `auth_plan`, `is_luxury`, `suggested_price_cents`
- Returns: `AuthChecklist | AgentToolError`
- Does NOT persist.

### `build_description`
- Input: `{ listingId: string; tone?: 'luxury' | 'casual' | 'technical' | 'streetwear' }`
- Reads: listing fields + pricing comps (top 5)
- Makes a single Claude call (claude-sonnet-4-6) to regenerate canonical + platform descriptions
- Returns: `ListingDescription | AgentToolError`
- Does NOT persist — agent calls `update_listing` to save if happy.

### `update_listing`
- Input: `{ listingId: string; fields: Partial<UpdateableListingFields> }`
- Validates with Zod (whitelist of agent-writeable fields)
- Writes to Supabase with service role client
- Invalidates listing snapshot (next `assembleContext` call will re-read)
- Returns: `{ ok: true; updated: string[] } | AgentToolError`

**Agent-writeable fields** (whitelist, not wildcard):
`title`, `description`, `condition`, `condition_notes`, `suggested_price_cents`, `final_price_cents`, `inclusions`, `auth_plan`, `photo_plan`, `platform_fields`, `tags`

NOT writeable by agent: `id`, `sku`, `status`, `pipeline_step`, `created_at`, `updated_at`

### `get_listing_summary`
- Input: `{ listingId: string }`
- Reads: full listing + photo count + conversation count
- Returns: structured summary object (~300 tokens when serialized)
- Does NOT persist.

### `get_photo_plan`
- Input: `{ listingId: string }`
- Reads: listing `photo_plan` + photos of type 'studio'
- Returns: shot list with `uploaded: boolean` per shot (matched by shot name)
- Does NOT persist.

---

## Conversation Persistence

- User message saved to `conversations` before calling Claude
- Assistant final text saved to `conversations` after loop completes
- Tool calls/results NOT saved to conversations (they're ephemeral execution state)
- `context_snapshot` stores `{ skillsHash: string, listingUpdatedAt: string }` for auditability
- History load: last 20 rows ordered by `created_at ASC` — no token counting, count limit only

---

## System Prompt Principles

The agent:
- Is proactive — works without asking permission
- Surfaces only genuine blockers (can't proceed without user input)
- Knows it's operating on a single listing (id always in context)
- Treats the skills file as authoritative for brand/category knowledge
- Does not reference Entrupy, Real Authentication, or other third-party auth services
- For items ≥ $500: recommends eBay Authenticity Guarantee or Poshmark Posh Authenticate

---

## Not In This Iteration

- **mcp-exec integration** — for data-heavy pricing aggregation. Filed as `ai-listings-mcp-exec` (P3 backlog).
- Fresh SerpAPI pricing searches from `research_pricing` — reads existing comps only.
- Streaming tool results to client (only name + ok status are streamed; full result stays server-side).

---

## Verification

1. Run `npx tsc --noEmit` — zero errors
2. POST `/api/agent/:listingId` with a valid in_loop listing
3. Check response is `text/event-stream`
4. Observe `tool_call` event for `research_pricing` in stream
5. Observe `text` events with real pricing analysis
6. Check `conversations` table for saved user + assistant turns
7. Call GET `/api/agent/:listingId` to confirm history is returned
