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
export function readStoredNumber(
  key: string,
  fallback: number,
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): number {
  try {
    const raw = storage?.getItem(key)
    if (raw == null || raw.trim() === '') return fallback
    const value = Number(raw)
    return Number.isFinite(value) ? value : fallback
  } catch {
    return fallback
  }
}

/** Messages after `lastSeenId`; a null or unknown `lastSeenId` counts every message. */
export function countUnread(messageIds: string[], lastSeenId: string | null): number {
  const seenAt = lastSeenId == null ? -1 : messageIds.lastIndexOf(lastSeenId)
  return messageIds.length - seenAt - 1
}
