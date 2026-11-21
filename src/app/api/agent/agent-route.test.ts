import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeSupabase } from '@/lib/test/fake-supabase'
import { handleAgentGet, handleAgentPost, type AgentPostDeps } from './[listingId]/route'
import type { ApiKeys } from '@/lib/user-api-keys'

// Not co-located with the route: see skip-bg-route.test.ts for why bracketed dirs hide tests.

function setup(user: { id: string } | null) {
  const tables = {
    listings: [{ id: 'l1', user_id: 'owner' }],
    conversations: [{ id: 'c1', listing_id: 'l1', role: 'user', content: 'hi', created_at: '1' }],
  }
  const session = fakeSupabase(tables, user)
  const admin = fakeSupabase(tables)
  const calls: string[] = []
  const deps: AgentPostDeps = {
    streamAgentResponse: async () => {
      calls.push('stream')
    },
    getUserApiKeys: async () => {
      calls.push('keys')
      return {} as ApiKeys
    },
  }
  return { session, admin, deps, calls }
}

const post = () => new Request('http://x', { method: 'POST', body: JSON.stringify({ message: 'hello' }) })

test('agent GET: unauthenticated gets 401 and reads nothing', async () => {
  const s = setup(null)
  const res = await handleAgentGet(s.session.client, s.admin.client, 'l1')
  assert.equal(res.status, 401)
  assert.deepEqual(s.admin.reads, [])
})

test('agent GET: non-owner gets 404 and conversations are never read', async () => {
  const s = setup({ id: 'intruder' })
  const res = await handleAgentGet(s.session.client, s.admin.client, 'l1')
  assert.equal(res.status, 404)
  assert.ok(!s.admin.reads.includes('conversations'))
})

test('agent GET: owner gets the conversation', async () => {
  const s = setup({ id: 'owner' })
  const res = await handleAgentGet(s.session.client, s.admin.client, 'l1')
  assert.equal(res.status, 200)
  assert.equal(((await res.json()) as { conversations: unknown[] }).conversations.length, 1)
})

test('agent POST: unauthenticated gets 401 and the agent never runs', async () => {
  const s = setup(null)
  const res = await handleAgentPost(s.session.client, 'l1', post(), s.deps)
  assert.equal(res.status, 401)
  assert.deepEqual(s.calls, [])
})

test('agent POST: non-owner gets 404 before keys load or the agent runs', async () => {
  const s = setup({ id: 'intruder' })
  const res = await handleAgentPost(s.session.client, 'l1', post(), s.deps)
  assert.equal(res.status, 404)
  assert.deepEqual(s.calls, [])
})

test('agent POST: owner streams the agent response', async () => {
  const s = setup({ id: 'owner' })
  const res = await handleAgentPost(s.session.client, 'l1', post(), s.deps)
  assert.equal(res.status, 200)
  await res.text()
  assert.deepEqual(s.calls, ['keys', 'stream'])
})
