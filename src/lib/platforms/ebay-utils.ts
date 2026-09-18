export function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&')
}

export function getEbayListingIdPattern(listingId: string): string {
  const escaped = escapeLikePattern(listingId)
  return `%/itm/${escaped}%`
}
