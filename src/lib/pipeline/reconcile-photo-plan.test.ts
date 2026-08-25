import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconcilePhotoPlan } from './reconcile-photo-plan'
import type { AuthStep, PhotoShot } from '@/types/listings'

function fixtureAuthStep(overrides: Partial<AuthStep> = {}): AuthStep {
  return {
    step: 'Zipper stamp',
    guidance: 'Check zipper pull for Lampo or Riri brand stamp',
    status: 'pending',
    photo_required: true,
    ...overrides,
  }
}

function fixtureShot(overrides: Partial<PhotoShot> = {}): PhotoShot {
  return {
    shot: 'Front flat',
    description: 'Front of bag laid flat',
    required: true,
    photo_type: 'studio',
    ...overrides,
  }
}

test('reconcilePhotoPlan does not add a duplicate when a matching photo_plan entry already covers the auth item', () => {
  const authPlan = [fixtureAuthStep()]
  const photoPlan = [
    fixtureShot({ shot: 'Front flat' }),
    fixtureShot({
      shot: 'Zipper pull close-up',
      description: 'Close-up of zipper pull hardware showing brand stamp (Lampo/Riri)',
    }),
  ]

  const result = reconcilePhotoPlan(authPlan, photoPlan)

  assert.equal(result.length, 2)
  assert.deepEqual(result, photoPlan)
})

test('reconcilePhotoPlan appends a new photo_plan entry when no existing shot covers a required auth item', () => {
  const authPlan = [fixtureAuthStep()]
  const photoPlan = [fixtureShot({ shot: 'Front flat' }), fixtureShot({ shot: 'Back flat' })]

  const result = reconcilePhotoPlan(authPlan, photoPlan)

  assert.equal(result.length, 3)
  assert.deepEqual(result.slice(0, 2), photoPlan)
  const added = result[2]
  assert.equal(added.required, true)
  assert.equal(added.photo_type, 'auth_card')
  assert.match(added.shot + ' ' + added.description, /zipper/i)
})

test('reconcilePhotoPlan never adds a shot for an auth item that does not require a photo', () => {
  const authPlan = [fixtureAuthStep({ photo_required: false })]
  const photoPlan = [fixtureShot({ shot: 'Front flat' })]

  const result = reconcilePhotoPlan(authPlan, photoPlan)

  assert.deepEqual(result, photoPlan)
})

test('reconcilePhotoPlan can append multiple gaps and skip multiple matches in the same call', () => {
  const authPlan = [
    fixtureAuthStep({ step: 'Zipper stamp', guidance: 'Check zipper pull for Lampo or Riri brand stamp' }),
    fixtureAuthStep({ step: 'Date code', guidance: 'Locate and photograph the interior date code stamp' }),
    fixtureAuthStep({ step: 'Not required', guidance: 'No photo needed for this one', photo_required: false }),
  ]
  const photoPlan = [
    fixtureShot({
      shot: 'Zipper pull close-up',
      description: 'Close-up of zipper pull hardware showing brand stamp (Lampo/Riri)',
    }),
  ]

  const result = reconcilePhotoPlan(authPlan, photoPlan)

  assert.equal(result.length, 2)
  assert.match(result[1].shot + ' ' + result[1].description, /date code/i)
})

test('reconcilePhotoPlan always adds a gap for an auth item with only one keyword, even when a shot contains that keyword', () => {
  const authPlan = [fixtureAuthStep({ step: 'Hologram', guidance: 'Check hologram' })]
  const photoPlan = [
    fixtureShot({
      shot: 'Hologram sticker close-up',
      description: 'Unrelated close-up that happens to mention hologram in passing',
    }),
  ]

  const result = reconcilePhotoPlan(authPlan, photoPlan)

  assert.equal(result.length, 2)
  assert.match(result[1].shot + ' ' + result[1].description, /hologram/i)
})
