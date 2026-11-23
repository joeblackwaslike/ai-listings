export function chunkWindows(
  start: number,
  end: number,
  bucketSeconds: number,
  maxBuckets: number,
): [number, number][] {
  const span = bucketSeconds * maxBuckets
  const windows: [number, number][] = []
  for (let from = start; from < end; from += span) windows.push([from, Math.min(from + span, end)])
  return windows
}

export function seriesQuery(nrql: string, start: number, end: number, bucketSeconds: number): string {
  return `${nrql} SINCE ${start} UNTIL ${end} TIMESERIES ${bucketSeconds} seconds`
}

interface BreachRule {
  operator: string
  threshold: number
  requiredPoints: number
  fill: number | null
}

function breaches(value: number, operator: string, threshold: number): boolean {
  if (operator === 'ABOVE') return value > threshold
  if (operator === 'BELOW') return value < threshold
  return value === threshold
}

export function breachEpisodes(series: (number | null)[], rule: BreachRule): number {
  let run = 0
  let episodes = 0
  for (const point of series) {
    const value = point ?? rule.fill
    run = value !== null && breaches(value, rule.operator, rule.threshold) ? run + 1 : 0
    if (run === rule.requiredPoints) episodes += 1
  }
  return episodes
}

export function seriesStats(series: (number | null)[]) {
  const values = series.filter((v): v is number => v !== null).sort((a, b) => a - b)
  if (values.length === 0) return null
  const middle = Math.floor(values.length / 2)
  const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2
  return {
    min: values[0],
    median,
    p95: values[Math.ceil(values.length * 0.95) - 1],
    max: values[values.length - 1],
  }
}

export function formatSpan(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return [days ? `${days}d` : '', days || hours ? `${hours}h` : '', `${minutes}m`].filter(Boolean).join(' ')
}

const WINDOW_PATTERN = /^([1-9]\d{0,3}) (minute|minutes|hour|hours|day|days)$/
const UNIT_SECONDS: Record<string, number> = { minute: 60, hour: 3600, day: 86400 }

export function windowSeconds(window: string): number {
  const match = WINDOW_PATTERN.exec(window)
  if (!match) throw new Error(`invalid window "${window}" (use e.g. "7 days")`)
  return Number(match[1]) * UNIT_SECONDS[match[2].replace(/s$/, '')]
}

export function seriesValue(row: Record<string, unknown>): number | null {
  const key = Object.keys(row).find((k) => !['beginTimeSeconds', 'endTimeSeconds', 'facet'].includes(k))
  const value = key === undefined ? null : row[key]
  if (value && typeof value === 'object') return Number(Object.values(value)[0])
  return typeof value === 'number' ? value : null
}
