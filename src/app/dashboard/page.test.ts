import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The dashboard's "Restart all failed" banner used to count agent_blocked=true listings as
// "failed" and offer to bulk-restart them. agent_blocked means a listing is deliberately held
// for human review, not a failed pipeline run -- see bulk-restart/route.test.ts. The banner's
// whole premise (agent_blocked count == failed-listing count) was the bug, and there is no
// other "failed" signal in this schema to replace it with (genuinely stalled runs now recover
// automatically via auto-recover-pipeline.ts), so the banner and its blockedCount are retired
// rather than re-scoped to a fabricated detection heuristic. Blocked listings stay visible via
// each card's own "Needs you" badge (StatusBadge.tsx).
const pageSource = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8')

test('dashboard page: does not render BlockedListingsBanner', () => {
  assert.equal(/BlockedListingsBanner/.test(pageSource), false)
})

test('dashboard page: does not compute an agent_blocked-based count', () => {
  assert.equal(/blockedCount/.test(pageSource), false)
})

test('BlockedListingsBanner.tsx no longer exists', () => {
  const path = fileURLToPath(new URL('../../components/dashboard/BlockedListingsBanner.tsx', import.meta.url))
  assert.equal(existsSync(path), false)
})
