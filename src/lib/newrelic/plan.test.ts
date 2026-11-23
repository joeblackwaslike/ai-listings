// @ts-expect-error bun:test has no type declarations installed (@types/bun absent)
import { describe, expect, test } from 'bun:test'
import { findOrphans, planChanges } from './plan'

const desired = (name: string, spec: unknown) => ({ name, spec })
const existing = (name: string, id: string, spec: unknown) => ({ name, id, spec })

describe('planChanges', () => {
  test('creates a resource that does not exist', () => {
    expect(planChanges('policy', [desired('a', { x: 1 })], [])).toEqual([
      { kind: 'policy', name: 'a', action: 'create' },
    ])
  })

  test('is a noop when the spec matches regardless of key order', () => {
    const rows = planChanges('policy', [desired('a', { x: 1, y: [{ b: 1, a: 2 }] })], [
      existing('a', '9', { y: [{ a: 2, b: 1 }], x: 1 }),
    ])
    expect(rows).toEqual([{ kind: 'policy', name: 'a', action: 'noop', id: '9' }])
  })

  test('updates when the spec differs and carries the existing id', () => {
    const rows = planChanges('condition', [desired('a', { x: 2 })], [existing('a', '4', { x: 1 })])
    expect(rows).toEqual([{ kind: 'condition', name: 'a', action: 'update', id: '4' }])
  })

  test('matches by name only and ignores unrelated existing resources', () => {
    const rows = planChanges('condition', [desired('a', 1)], [existing('other', '1', 1)])
    expect(rows[0].action).toBe('create')
  })

  test('never plans a delete for existing resources absent from desired', () => {
    const rows = planChanges('condition', [], [existing('old', '1', 1)])
    expect(rows).toEqual([])
  })

  test('refuses instead of updating a create-only resource that differs', () => {
    const rows = planChanges('destination', [desired('a', { x: 2 })], [existing('a', '4', { x: 1 })], {
      createOnly: true,
    })
    expect(rows).toEqual([{ kind: 'destination', name: 'a', action: 'refused', id: '4' }])
  })

  test('a create-only resource that matches is still a noop', () => {
    const rows = planChanges('destination', [desired('a', 1)], [existing('a', '4', 1)], { createOnly: true })
    expect(rows[0].action).toBe('noop')
  })

  test('throws when two existing resources share a desired name', () => {
    expect(() =>
      planChanges('dashboard', [desired('a', 1)], [existing('a', '1', 1), existing('a', '2', 1)]),
    ).toThrow('dashboard "a" matches 2 existing resources')
  })
})

describe('findOrphans', () => {
  test('lists existing resources absent from the desired names, read only', () => {
    expect(findOrphans('condition', ['a'], [existing('a', '1', 1), existing('old', '2', 1)])).toEqual([
      { kind: 'condition', name: 'old', action: 'orphan', id: '2' },
    ])
  })
})
