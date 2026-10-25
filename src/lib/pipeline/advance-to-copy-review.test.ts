import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { advanceToCopyReview } from './advance-to-copy-review'

function fakeSupabase(row: Record<string, unknown> | null) {
  const filters: Array<[string, unknown]> = []
  const builder: Record<string, unknown> = {
    update: () => builder,
    eq: (col: string, val: unknown) => (filters.push([col, val]), builder),
    in: (col: string, val: unknown) => (filters.push([col, val]), builder),
    select: () => builder,
    maybeSingle: async () => {
      const matches = filters.every(([col, val]) =>
        Array.isArray(val) ? val.includes(row?.[col]) : row?.[col] === val,
      )
      return { data: row && matches ? { id: row.id } : null, error: null }
    },
  }
  return { from: () => builder } as unknown as SupabaseClient
}

test('advances when condition is still confirmed', async () => {
  const db = fakeSupabase({ id: 'a', status: 'condition_gate', condition_confirmed: true })
  assert.equal(await advanceToCopyReview(db, 'a'), true)
})

test('matches no row when condition reassessment reset condition_confirmed', async () => {
  const db = fakeSupabase({ id: 'a', status: 'condition_gate', condition_confirmed: false })
  assert.equal(await advanceToCopyReview(db, 'a'), false)
})
