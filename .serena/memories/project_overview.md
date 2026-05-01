# ai-listings Project Overview

## Purpose
AI-powered resale listing platform. Handles photo intake, AI-driven listing generation, pricing comps, and conversation management for marketplace listings.

## Tech Stack
- Next.js 16.2.4 (App Router, React 19)
- TypeScript 5
- Supabase (Postgres + SSR auth)
- Inngest (event-driven pipeline / background jobs)
- Anthropic SDK (AI/LLM)
- Zod (validation)
- Tailwind CSS 4
- ESLint 9

## Key directories
- `src/` — all application source
- `src/lib/inngest/` — Inngest client + event type definitions
- `supabase/` — Supabase migrations/schema
- `public/` — static assets
