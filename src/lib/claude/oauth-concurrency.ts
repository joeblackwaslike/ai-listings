// The Agent SDK spawns a real `claude` CLI subprocess per call -- concurrent subprocesses on
// the same pod OOM'd it even with Inngest's function-level concurrency:{limit:1} on
// intake-pipeline, because subprocess memory hadn't settled before the next one started
// (ai-listings-2k0). Constraining it at the Inngest-function level serialized the ENTIRE
// pipeline -- DB writes, gate waits, SerpAPI calls, pricing research, draft listing -- behind
// Claude Vision specifically, so a burst of queued listings backed up completely unrelated
// work for tens of minutes even after a listing's gate had already been answered (ai-listings
// dashboard report, 2026-08-23: HB-0122's id-gate confirm sat unprocessed for 35+ minutes).
//
// This constrains the actual scarce resource directly: a small semaphore around just the
// subprocess spawn, with a cooldown before releasing a slot so memory has time to settle.
// Every runStructured/runText caller across the app is protected transparently, since they
// all funnel through oauth-backend.ts when the api-key backend isn't configured -- no
// per-function concurrency setting needs to know about this.
//
// Shipped at MAX_CONCURRENT=1 (a plain serial queue) through 2026-08-24. Raised to 2 the same
// day after that setting turned into its own bottleneck: recovering a backlog of several
// stuck listings means firing resume-pipeline for all of them at once, and with a hard
// serial queue plus oauth-backend.ts's up-to-3-minutes-per-call ceiling, a listing at
// position 4+ could legitimately sit mid-queue for 10-15+ minutes doing nothing wrong --
// just waiting its turn. Confirmed pod memory had real headroom for it (429Mi peak against a
// 1Gi limit under MAX_CONCURRENT=1); the app deployment's memory limit was raised alongside
// this change (deployment.yaml) specifically to keep that margin once two subprocesses can
// be resident at once instead of one.
const MAX_CONCURRENT = 2
const COOLDOWN_MS = 15_000

let activeCount = 0
const waiters: Array<() => void> = []

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function acquire(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      activeCount++
      resolve()
    })
  })
}

async function release(): Promise<void> {
  await sleep(COOLDOWN_MS)
  activeCount--
  const next = waiters.shift()
  if (next) next()
}

export async function withOauthConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  await acquire()
  try {
    return await fn()
  } finally {
    void release()
  }
}
