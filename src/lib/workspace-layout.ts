/** localStorage keys for the workspace shell's per-browser layout. */
export const STORAGE_KEYS = {
  photoW: 'ws.photoW',
  chatW: 'ws.chatW',
  chatOpen: 'ws.chatOpen',
} as const

/** Key holding the last assistant message id seen in a listing's chat. */
export function lastSeenKey(listingId: string): string {
  return `ws.lastSeen.${listingId}`
}

/** Clamp a column width to [min, total * maxFraction], rounded to whole px; min wins when the two cross. */
export function clampWidth(px: number, min: number, maxFraction: number, total: number): number {
  return Math.round(Math.max(min, Math.min(total * maxFraction, px)))
}

/** Read a number from storage, returning `fallback` on a missing, non-numeric or throwing read. */
export function readStoredNumber(key: string, fallback: number, storage?: Pick<Storage, 'getItem'>): number {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(key)
    if (raw == null || raw.trim() === '') return fallback
    const value = Number(raw)
    return Number.isFinite(value) ? value : fallback
  } catch {
    return fallback
  }
}

/** Messages created after `lastSeenAt`; a null or unparsable `lastSeenAt` counts every message. */
export function countUnread(createdAts: string[], lastSeenAt: string | null): number {
  const seen = lastSeenAt == null ? Number.NaN : Date.parse(lastSeenAt)
  if (Number.isNaN(seen)) return createdAts.length
  return createdAts.filter((at) => Date.parse(at) > seen).length
}

/** The later of two timestamps, compared as instants; a null `b` returns `a`. */
export function latestTimestamp(a: string, b: string | null): string {
  return b != null && Date.parse(b) > Date.parse(a) ? b : a
}
