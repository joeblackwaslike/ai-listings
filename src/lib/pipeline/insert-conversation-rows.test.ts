import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { insertConversationRowsSequentially } from './insert-conversation-rows'
import type { ConversationRow } from './insert-conversation-rows'

function fixtureRow(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return {
    listing_id: 'listing-1',
    role: 'assistant',
    content: 'hello',
    context_snapshot: null,
    ...overrides,
  }
}

function stubSupabase(insertResults: Array<{ error: { message: string } | null }>) {
  const insertCalls: unknown[] = []
  let call = 0
  const supabase = {
    from: (table: string) => {
      assert.equal(table, 'conversations')
      return {
        insert: (row: unknown) => {
          insertCalls.push(row)
          const result = insertResults[call] ?? { error: null }
          call += 1
          return Promise.resolve(result)
        },
      }
    },
  }
  return { supabase: supabase as unknown as SupabaseClient, insertCalls }
}

test('insertConversationRowsSequentially issues one insert call per row, each with a plain object (not an array)', async () => {
  const rows = [fixtureRow({ role: 'assistant', content: 'prompt' }), fixtureRow({ role: 'user', content: 'answer' }), fixtureRow({ role: 'assistant', content: 'ack' })]
  const { supabase, insertCalls } = stubSupabase([{ error: null }, { error: null }, { error: null }])

  await insertConversationRowsSequentially(supabase, rows, () => {
    throw new Error('onError should not be called when every insert succeeds')
  })

  assert.equal(insertCalls.length, 3)
  for (const call of insertCalls) {
    assert.equal(Array.isArray(call), false)
  }
  assert.deepEqual(insertCalls, rows)
})

test('insertConversationRowsSequentially calls onError once per failing row and still attempts the rest', async () => {
  const rows = [fixtureRow({ content: 'prompt' }), fixtureRow({ content: 'answer' }), fixtureRow({ content: 'ack' })]
  const { supabase, insertCalls } = stubSupabase([
    { error: null },
    { error: { message: 'insert failed' } },
    { error: null },
  ])

  const errors: string[] = []
  await insertConversationRowsSequentially(supabase, rows, (error) => errors.push(error.message))

  assert.equal(insertCalls.length, 3)
  assert.deepEqual(errors, ['insert failed'])
})

test('insertConversationRowsSequentially does nothing for an empty row list', async () => {
  const { supabase, insertCalls } = stubSupabase([])

  await insertConversationRowsSequentially(supabase, [], () => {
    throw new Error('onError should not be called')
  })

  assert.equal(insertCalls.length, 0)
})
