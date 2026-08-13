import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    dangerouslyAllowLocalIP: true,
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
