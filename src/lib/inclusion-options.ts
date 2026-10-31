import { getInclusionChecklist } from '@/lib/inclusions'
import type { ClothingSubType, JewelrySubType } from '@/types/listings'

export interface InclusionOption {
  value: string
  custom?: true
}

const COMMON_LIMIT = 4
const SEARCH_LIMIT = 8

// getInclusionChecklist ignores subType today, so one call per category branch covers every item.
const ALL_KNOWN_ITEMS = [
  ...new Set(['sneakers', 'watches', 'handbag', 'other'].flatMap((c) => getInclusionChecklist(c, null).map((i) => i.item))),
].sort((a, b) => a.localeCompare(b))

const norm = (s: string) => s.trim().toLowerCase()

/**
 * Options for the inclusion combobox. An empty query lists up to 4 of the category's common
 * items; a typed query filters every known checklist item and ends with a free-text option
 * unless the text already names a known or present item. Items already present are excluded.
 */
export function inclusionOptions(
  query: string,
  present: string[],
  category: string,
  subType: ClothingSubType | JewelrySubType | null
): InclusionOption[] {
  const presentSet = new Set(present.map(norm))
  const q = norm(query)
  if (!q) {
    return getInclusionChecklist(category, subType)
      .map((i) => i.item)
      .filter((item) => !presentSet.has(norm(item)))
      .slice(0, COMMON_LIMIT)
      .map((value) => ({ value }))
  }
  const matches: InclusionOption[] = ALL_KNOWN_ITEMS
    .filter((item) => !presentSet.has(norm(item)) && norm(item).includes(q))
    .slice(0, SEARCH_LIMIT)
    .map((value) => ({ value }))
  const exact = presentSet.has(q) || ALL_KNOWN_ITEMS.some((item) => norm(item) === q)
  return exact ? matches : [...matches, { value: query.trim(), custom: true }]
}

/** Typed text highlights the first option, as before; an empty field highlights nothing. */
export function defaultHighlight(query: string): number {
  return query.trim() ? 0 : -1
}

/**
 * What Enter adds: the highlighted option while the list is open, otherwise the typed text, so
 * a bare Enter on an empty field never adds an unchosen suggestion.
 */
export function enterValue(options: InclusionOption[], highlight: number, expanded: boolean, query: string): string | null {
  const highlighted = expanded && highlight >= 0 ? options[highlight] : undefined
  return highlighted?.value ?? (query.trim() || null)
}
