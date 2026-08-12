import { AuthExpiredError, PlatformError } from './errors';

/**
 * Pure error -> HTTP response mapping for the `post-to-ebay` route. Lives in its own module
 * (rather than inline in `route.ts`) so it can be unit-tested without pulling in
 * `next/headers`/Supabase — the route module's other imports need a live Next.js request
 * context and aren't safely importable from a plain `node --test` process.
 *
 * AuthExpiredError is checked before the generic PlatformError branch since it's a subclass
 * — every AuthExpiredError is also `instanceof PlatformError`.
 */
export function mapPostToEbayError(err: unknown): { status: number; error: string } {
  if (err instanceof AuthExpiredError) {
    return {
      status: 401,
      error: 'eBay authentication expired — reconnect your eBay account in Settings → Platforms',
    };
  }
  if (err instanceof PlatformError) {
    return { status: 422, error: err.message };
  }
  return { status: 500, error: 'Failed to post listing to eBay' };
}
