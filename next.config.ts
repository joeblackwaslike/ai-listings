import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: {
    // Default is 10MB -- src/proxy.ts's auth check makes every request go through Next's
    // proxy layer, which buffers/clones the body up to this limit before the route handler
    // ever sees it. Photo uploads (/api/upload) routinely exceed 10MB (modern phone PNGs),
    // silently truncating mid-multipart-boundary and failing request.formData() parsing --
    // surfaced to users as a generic "failed to upload" toast (ai-listings-96v).
    proxyClientMaxBodySize: '50mb',
  },
  images: {
    dangerouslyAllowLocalIP: true,
    minimumCacheTTL: 2592000,
    formats: ['image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: 'sup-ai-listings.napoleon-catfish.ts.net',
        pathname: '/storage/v1/object/public/**',
      },
      {
        // Cloudflare R2 public bucket URLs (photos migrated here from Supabase Storage —
        // see the R2 migration). Older listings still reference the Supabase Storage
        // patterns above; both need to stay allowlisted.
        protocol: 'https',
        hostname: '*.r2.dev',
      },
    ],
  },
}

export default nextConfig
