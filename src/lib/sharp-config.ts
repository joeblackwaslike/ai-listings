import sharp from 'sharp'

// The app pod is CPU-limited to 750m; libvips otherwise sizes its thread pool to the host's
// detected core count, which on the Pi nodes is well above what the container actually gets.
// Extra threads buy no real throughput under that cap but each holds its own decode buffer, so
// under concurrent uploads they multiply native memory instead -- confirmed as the proximate
// cause of a pod OOMKill crash loop (exitCode 137) the same day white-balance added two more
// sharp() decodes per upload (ai-listings-0yk). Side-effect-only import: pull this in before
// any other sharp usage in a route.
sharp.concurrency(1)
sharp.cache(false)
