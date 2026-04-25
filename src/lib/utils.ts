export function formatPrice(cents: number | null): string {
  if (cents == null) return '—'
  return `$${(cents / 100).toFixed(0)}`
}

export function relativeDate(isoString: string): string {
  const days = Math.floor((Date.now() - new Date(isoString).getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}
