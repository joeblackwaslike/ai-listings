import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGenderGateAck,
  buildGenderGatePrompt,
  buildIdGateAck,
  buildIdGatePrompt,
  buildIdGateSnapshot,
  isGenderGateAnswered,
  notableFeaturesOf,
  shouldAttemptPersistGreeting,
  synthesizeGenderGateAnswer,
  synthesizeIdGateAnswer,
} from './gate-messages'
import type { GenderGateListing, IdGateListing } from './gate-messages'
import type { DetailGateContext, Listing, ListingStatus } from '@/types/listings'

function idListing(overrides: Partial<IdGateListing> = {}): IdGateListing {
  return {
    brand: 'Rolex',
    category: 'watches',
    condition: 'good',
    condition_notes: null,
    intake_meta: null,
    ...overrides,
  }
}

function genderListing(overrides: Partial<GenderGateListing> = {}): GenderGateListing {
  return {
    category: 'watches',
    intake_meta: null,
    ...overrides,
  }
}

test('buildIdGatePrompt includes brand, category, and condition', () => {
  const prompt = buildIdGatePrompt(idListing())
  assert.match(prompt, /Brand: Rolex/)
  assert.match(prompt, /Category: watches/)
  assert.match(prompt, /Condition: good/)
})

test('buildIdGatePrompt includes notable features when present', () => {
  const prompt = buildIdGatePrompt(idListing({
    intake_meta: { visionAnalysis: { notable_features: ['Model: Submariner', 'Steel bracelet'] } },
  }))
  assert.match(prompt, /• Model: Submariner/)
  assert.match(prompt, /• Steel bracelet/)
})

test('buildIdGatePrompt omits the notable-features section when there are none', () => {
  const prompt = buildIdGatePrompt(idListing())
  assert.doesNotMatch(prompt, /•/)
})

test('buildIdGatePrompt includes condition notes when present', () => {
  const prompt = buildIdGatePrompt(idListing({ condition_notes: 'Small scratch on the clasp' }))
  assert.match(prompt, /Notes: Small scratch on the clasp/)
})

test('buildIdGatePrompt falls back to placeholders when brand/category/condition are missing', () => {
  const prompt = buildIdGatePrompt(idListing({ brand: null, category: null, condition: null }))
  assert.match(prompt, /Brand: Unknown brand/)
  assert.match(prompt, /Category: unknown category/)
  assert.match(prompt, /Condition: unknown condition/)
})

test('buildIdGateSnapshot captures brand/category/condition/notes/features', () => {
  const snapshot = buildIdGateSnapshot(idListing({
    condition_notes: 'Mint',
    intake_meta: { visionAnalysis: { notable_features: ['Model: Submariner'] } },
  }))
  assert.deepEqual(snapshot, {
    brand: 'Rolex',
    category: 'watches',
    condition: 'good',
    condition_notes: 'Mint',
    notable_features: ['Model: Submariner'],
  })
})

test('synthesizeIdGateAnswer returns a confirmed summary when confirmed is true', () => {
  const answer = synthesizeIdGateAnswer({ confirmed: true, corrections: null, listing: idListing() })
  assert.equal(answer, 'Confirmed — Rolex watches, condition: good.')
})

test('synthesizeIdGateAnswer returns the raw corrections text when confirmed is false', () => {
  const answer = synthesizeIdGateAnswer({
    confirmed: false,
    corrections: "That's actually an Omega, not a Rolex",
    listing: idListing(),
  })
  assert.equal(answer, "That's actually an Omega, not a Rolex")
})

test('buildIdGateAck varies by confirmed', () => {
  assert.equal(
    buildIdGateAck({ confirmed: true }),
    'Confirmed! Running pricing research now — the listing will update in a moment.'
  )
  assert.equal(
    buildIdGateAck({ confirmed: false }),
    'Got it — re-running the identification with your correction. The card will update shortly.'
  )
})

test('buildGenderGatePrompt asks for gender and size when the category needs both', () => {
  const { message, detailGateContext } = buildGenderGatePrompt(genderListing({ category: 'clothing' }))
  assert.match(message, /what's the gender and size/)
  assert.equal(detailGateContext.categoryNeedsGender, true)
  assert.equal(detailGateContext.categoryNeedsMeasurements, true)
})

test('buildGenderGatePrompt asks for measurements only when the category needs no gender', () => {
  const { message, detailGateContext } = buildGenderGatePrompt(genderListing({ category: 'handbag' }))
  assert.match(message, /I need a few measurements/)
  assert.equal(detailGateContext.categoryNeedsGender, false)
  assert.equal(detailGateContext.categoryNeedsMeasurements, true)
  assert.deepEqual(detailGateContext.measurementFields.map((f) => f.key), ['width', 'height', 'depth'])
})

test('buildGenderGatePrompt threads notableFeatures through to detect an irregular ring band', () => {
  const listing = genderListing({
    category: 'jewelry',
    intake_meta: { visionAnalysis: { notable_features: ['Model: Teardrop Bypass Ring', 'Style: Open bypass band'] } },
  })
  const { detailGateContext } = buildGenderGatePrompt(listing)
  assert.equal(detailGateContext.subTypeHint, 'ring')
  assert.deepEqual(detailGateContext.measurementFields.map((f) => f.key), ['ring_inscribed_size', 'ring_id_widest_mm', 'ring_id_narrowest_mm'])
})

test('buildGenderGatePrompt pre-fills necklace chain length when the vision notes state it', () => {
  const listing = genderListing({
    category: 'jewelry',
    intake_meta: {
      visionAnalysis: {
        notable_features: ['Model: Elsa Peretti Teardrop Pendant Necklace', 'Chain length: approximately 16"'],
      },
    },
  })
  const { detailGateContext } = buildGenderGatePrompt(listing)
  assert.equal(detailGateContext.subTypeHint, 'necklace')
  assert.deepEqual(detailGateContext.defaultMeasurementValues, { necklace_chain_length_in: 16 })
})

test('buildGenderGatePrompt leaves defaultMeasurementValues undefined when chain length is not parseable', () => {
  const listing = genderListing({
    category: 'jewelry',
    intake_meta: {
      visionAnalysis: {
        notable_features: ['Model: Elsa Peretti Bean Pendant Necklace', 'Chain style: fine cable chain'],
      },
    },
  })
  const { detailGateContext } = buildGenderGatePrompt(listing)
  assert.equal(detailGateContext.subTypeHint, 'necklace')
  assert.equal(detailGateContext.defaultMeasurementValues, undefined)
})

test('buildGenderGatePrompt leaves defaultMeasurementValues undefined for non-necklace jewelry', () => {
  const listing = genderListing({
    category: 'jewelry',
    intake_meta: { visionAnalysis: { notable_features: ['Model: Solitaire Diamond Ring'] } },
  })
  const { detailGateContext } = buildGenderGatePrompt(listing)
  assert.equal(detailGateContext.subTypeHint, 'ring')
  assert.equal(detailGateContext.defaultMeasurementValues, undefined)
})

test('synthesizeGenderGateAnswer combines gender and measurement lines', () => {
  const detailGateContext: DetailGateContext = {
    category: 'clothing',
    categoryNeedsGender: true,
    subTypeHint: 'jeans',
    categoryNeedsMeasurements: true,
    measurementFields: [
      { key: 'waist', label: 'Waist', hint: 'in inches' },
      { key: 'inseam', label: 'Inseam', hint: 'in inches' },
    ],
  }
  const answer = synthesizeGenderGateAnswer({
    gender: 'mens',
    measurements: { waist: 32, inseam: 30 },
    detailGateContext,
  })
  assert.equal(answer, "Men's — Waist: 32 in (813 mm), Inseam: 30 in (762 mm)")
})

test('synthesizeGenderGateAnswer handles measurements-only (no gender)', () => {
  const detailGateContext: DetailGateContext = {
    category: 'handbag',
    categoryNeedsGender: false,
    subTypeHint: null,
    categoryNeedsMeasurements: true,
    measurementFields: [
      { key: 'height', label: 'Height', hint: 'in inches' },
      { key: 'width', label: 'Width', hint: 'in inches' },
      { key: 'depth', label: 'Depth', hint: 'in inches' },
    ],
  }
  const answer = synthesizeGenderGateAnswer({
    gender: null,
    measurements: { height: 10, width: 6, depth: 3 },
    detailGateContext,
  })
  assert.equal(answer, 'Height: 10 in (254 mm), Width: 6 in (152 mm), Depth: 3 in (76 mm)')
})

test('buildGenderGateAck returns the fixed acknowledgment', () => {
  assert.equal(
    buildGenderGateAck(),
    'Got it — running pricing research now. The listing will update in a moment.'
  )
})

test('isGenderGateAnswered is false for empty history', () => {
  assert.equal(isGenderGateAnswered([]), false)
})

test('isGenderGateAnswered is false when the last message is not the ack', () => {
  assert.equal(
    isGenderGateAnswered([
      { role: 'assistant', content: 'Quick question before I run pricing — I need a few measurements.' },
      { role: 'user', content: 'Chain Length: 17 in' },
    ]),
    false
  )
})

test('isGenderGateAnswered is true when the last message is the gender-gate ack', () => {
  assert.equal(
    isGenderGateAnswered([
      { role: 'assistant', content: 'Quick question before I run pricing — I need a few measurements.' },
      { role: 'user', content: 'Chain Length: 17 in' },
      { role: 'assistant', content: buildGenderGateAck() },
    ]),
    true
  )
})

test('isGenderGateAnswered is false when the ack text appears but is not the last message', () => {
  assert.equal(
    isGenderGateAnswered([
      { role: 'assistant', content: buildGenderGateAck() },
      { role: 'user', content: 'What is the current price?' },
    ]),
    false
  )
})

function greetingListing(overrides: Partial<Pick<Listing, 'status' | 'agent_blocked'>> = {}): Pick<Listing, 'status' | 'agent_blocked'> {
  return {
    status: 'in_loop',
    agent_blocked: false,
    ...overrides,
  }
}

test('shouldAttemptPersistGreeting is false for in_loop (transient UI hint, not persisted)', () => {
  // in_loop greetings are transient — they change as the listing progresses and must not be
  // written to conversations (leads to stale "upload photos" messages after upload completes).
  assert.equal(shouldAttemptPersistGreeting(greetingListing(), 'Upload your studio photos...', []), false)
})

test('shouldAttemptPersistGreeting is false when firstMessage is null', () => {
  assert.equal(shouldAttemptPersistGreeting(greetingListing(), null, []), false)
})

test('shouldAttemptPersistGreeting is true for a newly agent_blocked listing (the failure reason must reach the chat)', () => {
  // Regression: HB-0091 was agent_blocked with a real pipeline failure reason, but the chat
  // showed neither a prompt nor the reason -- the old blanket `agent_blocked -> false` rule
  // meant the reason never persisted even though `conversations` already had prior history.
  assert.equal(shouldAttemptPersistGreeting(greetingListing({ agent_blocked: true }), 'step3: pricing failed', []), true)
})

test('shouldAttemptPersistGreeting is false for statuses outside in_loop/id_gate/gender_gate', () => {
  const otherStatuses: ListingStatus[] = ['intake', 'finalizing', 'published', 'archived']
  for (const status of otherStatuses) {
    assert.equal(
      shouldAttemptPersistGreeting(greetingListing({ status }), 'some greeting', []),
      false,
      `expected false for status ${status}`
    )
  }
})

test('shouldAttemptPersistGreeting is true for id_gate with a message', () => {
  // Regression: a stale in_loop greeting persisted before the pipeline reached id_gate must
  // not permanently block the real id_gate prompt (with item description) from ever
  // appearing. The "does this already match the last message" dedup itself now lives in the
  // insert_conversation_if_new DB function (migration 0022) -- not here, and deliberately so:
  // deciding it against a `history` array raced under concurrent page loads and produced
  // duplicate gate prompts seconds apart (HB-0102, SN-0035, 2026-08-21).
  assert.equal(
    shouldAttemptPersistGreeting(greetingListing({ status: 'id_gate' }), "I've analyzed the photo...", []),
    true
  )
})

test('shouldAttemptPersistGreeting is true for gender_gate with a message', () => {
  assert.equal(shouldAttemptPersistGreeting(greetingListing({ status: 'gender_gate' }), 'What is the gender?', []), true)
})

test('notableFeaturesOf reads notable_features from visionAnalysis when present', () => {
  const features = notableFeaturesOf({ visionAnalysis: { notable_features: ['Model: Submariner'] } })
  assert.deepEqual(features, ['Model: Submariner'])
})

test('notableFeaturesOf falls back to textAnalysis when visionAnalysis is absent', () => {
  const features = notableFeaturesOf({ textAnalysis: { notable_features: ['Model: Solitaire Ring'] }, source: 'text' })
  assert.deepEqual(features, ['Model: Solitaire Ring'])
})

test('notableFeaturesOf returns an empty array when intake_meta is null', () => {
  assert.deepEqual(notableFeaturesOf(null), [])
})

test('notableFeaturesOf returns an empty array when neither visionAnalysis nor textAnalysis is present', () => {
  assert.deepEqual(notableFeaturesOf({}), [])
})
