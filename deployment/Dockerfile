FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci --omit=dev

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Next's standalone output-file-tracing can miss optional, dynamically-resolved native-binary
# packages — the Agent SDK ships its platform binary as one (@anthropic-ai/claude-agent-sdk-
# linux-arm64-musl for this Alpine/ARM64 image). Copy both explicitly from the builder stage's
# full `npm ci` install rather than trust tracing to have included them.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@anthropic-ai/claude-agent-sdk ./node_modules/@anthropic-ai/claude-agent-sdk
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@anthropic-ai/claude-agent-sdk-linux-arm64-musl ./node_modules/@anthropic-ai/claude-agent-sdk-linux-arm64-musl

# Build-time smoke test — fail the build if the SDK (ESM-only) can't actually be resolved from
# the final image, instead of discovering it at first real request in production.
RUN node -e "import('@anthropic-ai/claude-agent-sdk').then(() => console.log('claude-agent-sdk: OK')).catch((e) => { console.error(e); process.exit(1); })"

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
