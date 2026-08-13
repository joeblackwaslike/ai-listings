import type { SupabaseClient } from '@supabase/supabase-js'

export interface ConversationRow {
  listing_id: string
  role: 'assistant' | 'user'
  content: string
  context_snapshot: unknown
}

// Inserted one at a time, not as a single batched array: Postgres fixes now()
// at transaction start, so a single multi-row insert gives every row the same
// created_at, and reads sort by created_at with no secondary tiebreaker —
// batching would make the persisted prompt/answer/ack order unreliable.
export async function insertConversationRowsSequentially(
  supabase: SupabaseClient,
  rows: ConversationRow[],
  onError: (error: { message: string }) => void
): Promise<void> {
  for (const row of rows) {
    const { error } = await supabase.from('conversations').insert(row)
    if (error) onError(error)
  }
}
