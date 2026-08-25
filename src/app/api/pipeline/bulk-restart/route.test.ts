import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// agent_blocked = true means a listing is deliberately held for human review (e.g. suspected
// counterfeit pending professional authentication) -- it is NOT a stuck/crashed pipeline run.
// Genuinely stalled/orphaned pipeline runs are recovered automatically by
// auto-recover-pipeline.ts's cron (find_stalled_resumable_listings, migration 0031),
// independent of agent_blocked. This endpoint used to select every agent_blocked=true row and
// re-fire its pipeline, which was one click away from bypassing a deliberate hold regardless of
// agent_blocked_reason. There is no other "failed" signal in this schema (ListingStatus has no
// failed/error state), so the only correct fix is that this route never queries listings by, or
// otherwise acts on, agent_blocked at all -- unblocking stays an explicit, individual, per-card
// action (ListingCard.tsx / StatusBadge.tsx's "Needs you" state).
const routeSource = readFileSync(fileURLToPath(new URL('./route.ts', import.meta.url)), 'utf8')

test('bulk-restart route: never filters, selects, or writes the agent_blocked column', () => {
  // Matches actual code usage (a query filter, a select-list entry, or an object key) rather
  // than banning the bare word -- the file is allowed to explain in prose why agent_blocked
  // is off limits here without failing this guard.
  assert.equal(/['"`]agent_blocked['"`]|agent_blocked\s*:/.test(routeSource), false)
})

test('bulk-restart route: never queries the listings table', () => {
  assert.equal(/\.from\(\s*['"]listings['"]\s*\)/.test(routeSource), false)
})

test('bulk-restart route: never fires an Inngest pipeline event', () => {
  assert.equal(/inngest\.send/.test(routeSource), false)
})
