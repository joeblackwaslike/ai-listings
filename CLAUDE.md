# AI Listings — Claude Code Project Config

## Project context

Full-stack Next.js resale listing platform. AI agent as primary interface. One photo upload → one listing → automated pipeline → agent-assisted iteration → eBay/Poshmark export.

Stack: Next.js (App Router) · Supabase · Inngest · Vercel · PhotoRoom · SerpAPI · Anthropic Claude.

## Skills — always activate for this project

### Framework / infra

- `vercel-plugin:nextjs` — Next.js App Router patterns, server actions, RSC
- `vercel-plugin:react-best-practices` — component patterns, state management
- `vercel-plugin:ai-sdk` — Vercel AI SDK for streaming agent responses
- `supabase:supabase` — Supabase client, RLS, realtime subscriptions
- `supabase:supabase-postgres-best-practices` — schema, indexes, JSONB queries

### Workflows

- Activate Inngest skills (`npx skills add inngest/inngest-skills`) when working on pipeline steps, event schemas, retries, or fan-out patterns
- `backend-development:workflow-orchestration-patterns` — for Inngest function design

### AI / agent

- `llm-application-dev:ai-assistant` — agent architecture, context assembly, streaming
- `llm-application-dev:prompt-engineering-patterns` — system prompt design, caching

### Dev workflow

- mcp-exec is installed and active. Use `exec()` for any multi-step research, API exploration, or large-response tasks. See `docs/thick-tools-pattern.md` for agent tool design.
- `docs/gap-mcp-skills-recs.md` — MCP setup commands for Inngest, eBay, SerpAPI

## MCP servers — activate when relevant

| Server | When to use |
| --- | --- |
| `vercel-plugin_vercel__authenticate` | Deployments, env vars, logs, domains |
| `supabase_supabase__authenticate` | Schema, RLS, storage, realtime config |
| `inngest-dev` (local CLI) | Monitoring functions, testing events, inspecting runs |
| `ebay-sold` (Apify) | Researching eBay sold/completed comp prices |
| `ebay` (ebay-mcp) | eBay seller APIs, active listings, orders |
| `serpapi` (hosted MCP) | Google Lens product ID, cross-platform pricing search |
| `mcp-exec` | Sandbox execution — keep intermediate results out of context |

See `docs/gap-mcp-skills-recs.md` for `claude mcp add` commands.

## Agent behavior — system prompt guidelines

The production agent for this app should follow these principles (encode in `lib/agent/system-prompt.ts`):

- **Proactive, not permission-seeking.** Do not ask "should I proceed?" for routine actions. Execute and report.
- **Minimize interruptions.** There may be 30–40 listings in progress. Only surface a decision when genuinely blocked — missing information, ambiguous identification, photo quality failure, or a choice with meaningfully different outcomes.
- **Interrupt for:** identification confirmation gate, photo quality failures, auth checklist steps that require a user action (photographing a specific detail).
- **Do not interrupt for:** running pricing research, generating descriptions, reordering photos, calculating confidence scores, updating fields.

## Key docs

- `docs/superpowers/specs/2026-04-22-ai-listings-design.md` — design spec
- `docs/superpowers/specs/2026-04-22-ai-listings-prd.md` — PRD (diagrams, wireframes, open questions)
- `docs/thick-tools-pattern.md` — agent tool design (thick tools, TypeScript interfaces)
- `docs/gap-mcp-skills-recs.md` — MCP setup for gap services
- `skills/agent-skills.md` — brand/category knowledge injected into agent context


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
