// The Agent SDK spawns a real `claude` CLI subprocess per call -- concurrent subprocesses on
// the same pod OOM'd it even with Inngest's function-level concurrency:{limit:1} on
// intake-pipeline, because subprocess memory hadn't settled before the next one started
// (ai-listings-2k0). Constraining it at the Inngest-function level serialized the ENTIRE
// pipeline -- DB writes, gate waits, SerpAPI calls, pricing research, draft listing -- behind
// Claude Vision specifically, so a burst of queued listings backed up completely unrelated
// work for tens of minutes even after a listing's gate had already been answered (ai-listings
// dashboard report, 2026-08-23: HB-0122's id-gate confirm sat unprocessed for 35+ minutes).
//
// This constrains the actual scarce resource directly: a per-process (per-pod) mutex around
// just the subprocess spawn, with a cooldown before releasing to the next queued caller so
// memory has time to settle. Every runStructured/runText caller across the app is protected
// transparently, since they all funnel through oauth-backend.ts when the api-key backend isn't
// configured -- no per-function concurrency setting needs to know about this.
const COOLDOWN_MS = 15_000

let queue: Promise<void> = Promise.resolve()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function withOauthConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  const turn = queue.then(fn, fn)
  queue = turn.then(
    () => sleep(COOLDOWN_MS),
    () => sleep(COOLDOWN_MS)
  )
  return turn
}
