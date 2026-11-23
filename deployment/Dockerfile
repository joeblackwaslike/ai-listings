ARG PNPM_VERSION=11.28.9

# Pinned by digest; a digest overrides the tag, so bump the tag and digest together.
FROM node:22-trixie-slim@sha256:68c76cfad89921b927eae28ba21407475e29d0ce450afcdbe70c1532db042b64 AS node

FROM node AS builder
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
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

# Pinned by digest so a base-image republish cannot change production unreviewed.
FROM joeblackwaslike/debian:trixie@sha256:f15486ca8bf38bda35713e6e166384d121a23f0215947793e49d595ccc04362b AS runner
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 ca-certificates passwd && \
    apt-get clean && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Next's standalone output-file-tracing can miss optional, dynamically-resolved native-binary
# packages -- the Agent SDK ships its platform binary as one (claude-agent-sdk-linux-<arch>,
# whichever pnpm installed for this image). Copy the SDK and its platform package explicitly from
# the builder's full install rather than trust tracing to have included them.
COPY --from=builder --chown=nextjs:nodejs /agent-sdk/ ./node_modules/@anthropic-ai/

# Build-time smoke test -- fail the build if the SDK (ESM-only) can't actually be resolved from
# the final image, instead of discovering it at first real request in production.
RUN node --input-type=module -e "import('@anthropic-ai/claude-agent-sdk').then(() => console.log('claude-agent-sdk: OK')).catch((e) => { console.error(e); process.exit(1); })"

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
