import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runStep4bPhotoRoom } from './step4b-photoroom'
import type { ApiKeys } from '@/lib/user-api-keys'

const apiKeys = {} as ApiKeys

function stubListingsSupabase(skipBackgroundRemoval: boolean): SupabaseClient {
  const supabase = {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _id: string) => ({
          single: async () => ({ data: { skip_background_removal: skipBackgroundRemoval }, error: null }),
        }),
      }),
    }),
  }
  return supabase as unknown as SupabaseClient
}

test('runStep4bPhotoRoom: jewelry category routes through processRawPhoto, not removeBackground', async () => {
  const calls: string[] = []

  await runStep4bPhotoRoom('listing-1', 'https://x/raw.jpg', 'photo-1', apiKeys, 'jewelry', {
    processRaw: async () => {
      calls.push('processRaw')
    },
    removeBg: async () => {
      calls.push('removeBg')
    },
  })

  assert.deepEqual(calls, ['processRaw'])
})

test('runStep4bPhotoRoom: listing.skip_background_removal routes through processRawPhoto, not removeBackground', async () => {
  const calls: string[] = []

  await runStep4bPhotoRoom('listing-1', 'https://x/raw.jpg', 'photo-1', apiKeys, 'handbag', {
    supabase: stubListingsSupabase(true),
    processRaw: async () => {
      calls.push('processRaw')
    },
    removeBg: async () => {
      calls.push('removeBg')
    },
  })

  assert.deepEqual(calls, ['processRaw'])
})

test('runStep4bPhotoRoom: neither jewelry nor skip_background_removal still routes through removeBackground', async () => {
  const calls: string[] = []

  await runStep4bPhotoRoom('listing-1', 'https://x/raw.jpg', 'photo-1', apiKeys, 'handbag', {
    supabase: stubListingsSupabase(false),
    processRaw: async () => {
      calls.push('processRaw')
    },
    removeBg: async () => {
      calls.push('removeBg')
    },
  })

  assert.deepEqual(calls, ['removeBg'])
})

test('runStep4bPhotoRoom: storage path is scoped per intake photo id, not shared across a listing\'s photos', async () => {
  const paths: string[] = []
  const deps = {
    processRaw: async (_photoId: string, _photoUrl: string, storagePath: string) => {
      paths.push(storagePath)
    },
    removeBg: async () => {},
  }

  await runStep4bPhotoRoom('listing-1', 'https://x/raw.jpg', 'photo-1', apiKeys, 'jewelry', deps)
  await runStep4bPhotoRoom('listing-1', 'https://x/raw.jpg', 'photo-2', apiKeys, 'jewelry', deps)

  assert.notEqual(paths[0], paths[1])
  assert.match(paths[0], /photo-1/)
  assert.match(paths[1], /photo-2/)
})
