ARG BUN_VERSION=1.4.4
ARG NODE_VERSION=22
ARG PNPM_VERSION=11.28.9

FROM oven/bun:${BUN_VERSION}-alpine AS bun

# Builder is Node only because pnpm 11 itself runs on Node. Bun is copied in so the build and
# every package script run on Bun, matching the production runtime.
FROM node:${NODE_VERSION}-alpine AS builder
ARG PNPM_VERSION
RUN apk add --no-cache libgcc libstdc++ && npm install -g pnpm@${PNPM_VERSION}
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/poshmark-seller-sdk/package.json ./packages/poshmark-seller-sdk/package.json
RUN pnpm install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
RUN pnpm run build
# pnpm keeps these as symlinks into node_modules/.pnpm; dereference so the runner gets real files.
RUN mkdir /agent-sdk && cp -rL node_modules/@anthropic-ai/claude-agent-sdk* /agent-sdk/

FROM oven/bun:${BUN_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Next's standalone output-file-tracing can miss optional, dynamically-resolved native-binary
# packages -- the Agent SDK ships its platform binary as one (claude-agent-sdk-linux-<arch>[-musl],
# whichever pnpm installed for this image). Copy the SDK and its platform package explicitly from
# the builder's full install rather than trust tracing to have included them.
COPY --from=builder --chown=nextjs:nodejs /agent-sdk/ ./node_modules/@anthropic-ai/

# Build-time smoke test -- fail the build if the SDK (ESM-only) can't actually be resolved from
# the final image, instead of discovering it at first real request in production.
RUN bun -e "import('@anthropic-ai/claude-agent-sdk').then(() => console.log('claude-agent-sdk: OK')).catch((e) => { console.error(e); process.exit(1); })"

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["bun", "server.js"]
