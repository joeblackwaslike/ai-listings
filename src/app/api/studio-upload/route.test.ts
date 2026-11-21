import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { fakeSupabase } from '@/lib/test/fake-supabase'
import { handleStudioUpload, type StudioUploadDeps } from './route'

async function uploadRequest() {
  const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()
  const form = new FormData()
  form.set('photo', new File([new Uint8Array(jpeg)], 'a.jpg', { type: 'image/jpeg' }))
  form.set('listingId', 'l1')
  return new Request('http://x', { method: 'POST', body: form })
}

function setup(user: { id: string } | null) {
  const tables = { listings: [{ id: 'l1', user_id: 'owner' }], photos: [] }
  const session = fakeSupabase(tables, user)
  const admin = fakeSupabase(tables)
  const calls: string[] = []
  const deps: StudioUploadDeps = {
    uploadFile: async (path) => {
      calls.push(`upload:${path}`)
      return `https://r2/${path}`
    },
    sendEvent: async () => {
      calls.push('event')
    },
  }
  return { session, admin, deps, calls }
}

test('studio-upload: unauthenticated gets 401 and nothing is stored or written', async () => {
  const s = setup(null)
  const res = await handleStudioUpload(await uploadRequest(), s.session.client, s.admin.client, s.deps)
  assert.equal(res.status, 401)
  assert.deepEqual(s.calls, [])
  assert.deepEqual(s.admin.writes, [])
})

test('studio-upload: non-owner gets 404 before any storage or DB write', async () => {
  const s = setup({ id: 'intruder' })
  const res = await handleStudioUpload(await uploadRequest(), s.session.client, s.admin.client, s.deps)
  assert.equal(res.status, 404)
  assert.deepEqual(s.calls, [])
  assert.deepEqual(s.admin.writes, [])
})

test('studio-upload: owner uploads, inserts the photo row and fires the event', async () => {
  const s = setup({ id: 'owner' })
  const res = await handleStudioUpload(await uploadRequest(), s.session.client, s.admin.client, s.deps)
  assert.equal(res.status, 200)
  assert.equal(s.admin.writes.length, 1)
  assert.equal(s.calls.length, 2)
})

test('studio-upload: replacesPhotoId must reference a quality-failed studio photo on this listing', async () => {
  const photos = (meta: unknown) => [{ id: 'p1', listing_id: 'l1', type: 'studio', photoroom_meta: meta }]
  const run = async (meta: unknown) => {
    const s = setup({ id: 'owner' })
    s.session.tables.photos = photos(meta)
    const req = await uploadRequest()
    const form = await req.formData()
    form.set('replacesPhotoId', 'p1')
    const res = await handleStudioUpload(new Request('http://x', { method: 'POST', body: form }), s.session.client, s.admin.client, s.deps)
    return { res, s }
  }

  const rejected = await run({ quality_failed: false })
  assert.equal(rejected.res.status, 400)
  assert.deepEqual(rejected.s.calls, [])

  const accepted = await run({ quality_failed: true })
  assert.equal(accepted.res.status, 200)
})
