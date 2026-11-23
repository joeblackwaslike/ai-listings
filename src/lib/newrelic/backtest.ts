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
