// @ts-expect-error bun:test has no type declarations installed (@types/bun absent)
import { describe, expect, test } from 'bun:test'
import { breachEpisodes, chunkWindows, formatSpan, seriesQuery, seriesStats } from './backtest'

describe('chunkWindows', () => {
  test('splits a range into windows of at most maxBuckets buckets', () => {
    expect(chunkWindows(0, 1000, 60, 5)).toEqual([
      [0, 300],
      [300, 600],
      [600, 900],
      [900, 1000],
    ])
  })

  test('returns nothing for an empty range', () => {
    expect(chunkWindows(10, 10, 60, 5)).toEqual([])
  })
})

describe('seriesQuery', () => {
  test('appends absolute bounds and the bucket size', () => {
    expect(seriesQuery('SELECT count(*) FROM Log', 100, 400, 60)).toBe(
      'SELECT count(*) FROM Log SINCE 100 UNTIL 400 TIMESERIES 60 seconds',
    )
  })
})

describe('breachEpisodes', () => {
  const above = { operator: 'ABOVE', threshold: 5, requiredPoints: 3, fill: null }

  test('counts a run only when it reaches the required length', () => {
    expect(breachEpisodes([9, 9, 1, 9, 9, 9, 1], above)).toBe(1)
  })

  test('counts a long run once', () => {
    expect(breachEpisodes([9, 9, 9, 9, 9, 9, 9], above)).toBe(1)
  })

  test('counts separate runs separately', () => {
    expect(breachEpisodes([9, 9, 9, 0, 9, 9, 9], above)).toBe(2)
  })

  test('uses strict comparison for ABOVE and BELOW', () => {
    expect(breachEpisodes([5, 5, 5], above)).toBe(0)
    expect(breachEpisodes([1, 1, 1], { ...above, operator: 'BELOW', threshold: 1 })).toBe(0)
    expect(breachEpisodes([0, 0, 0], { ...above, operator: 'BELOW', threshold: 1 })).toBe(1)
  })

  test('null points break a run when there is no fill', () => {
    expect(breachEpisodes([9, 9, null, 9, 9], above)).toBe(0)
  })

  test('null points take the static fill value', () => {
    expect(breachEpisodes([null, null, null], { operator: 'BELOW', threshold: 1, requiredPoints: 3, fill: 0 })).toBe(1)
  })
})

describe('seriesStats', () => {
  test('reports min, median, p95 and max over non-null points', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(seriesStats([...values, null])).toEqual({ min: 1, median: 50.5, p95: 95, max: 100 })
  })

  test('returns null for an empty series', () => {
    expect(seriesStats([null])).toBeNull()
  })
})

describe('formatSpan', () => {
  test('formats seconds as days, hours and minutes', () => {
    expect(formatSpan(3 * 86400 + 5 * 3600 + 30 * 60)).toBe('3d 5h 30m')
    expect(formatSpan(5 * 3600 + 60)).toBe('5h 1m')
    expect(formatSpan(120)).toBe('2m')
    expect(formatSpan(20)).toBe('0m')
  })
})
