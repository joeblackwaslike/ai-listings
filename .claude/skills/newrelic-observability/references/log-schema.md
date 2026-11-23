# Log schema

Logs are collected by Fluent Bit and stored as the `Log` event type. Every container has these attributes:

| Attribute | Meaning |
| --- | --- |
| `namespace_name` | Kubernetes namespace (`ai-listings`, `sup-ai-listings`, `github-runner`, ...) |
| `container_name` | Container, not deployment (`ai-listings`, `inngest`, `supabase-auth`, ...) |
| `pod_name`, `node_name` | Pod and node that produced the line |
| `stream` | `stdout` or `stderr` |
| `message` | The raw line, plain text |
| `timestamp` | Epoch milliseconds |

Containers that emit JSON also populate `level`, `time`, `event`, `event_id`, `internal_id`, `messageId` and `cluster_name`. `inngest` has `level` in uppercase (`INFO`); `supabase-auth` has it in lowercase (`info`, `warning`, `error`). The app container `ai-listings` has none of these, so match severity from the message text there.

## App line shapes (container `ai-listings`)

- `[auth] {"ts":...,"event":"proxy_check",...}` is a per-request auth diagnostic. The large majority of volume. `getUserError` with `AuthSessionMissingError` is normal for logged-out requests.
- `[sync-platform-messages] error for platform=ebay userId=...` and `[sync-platform-orders] error for platform=...` are real failures from the Inngest polling functions.
- `[ebay] API error body: {...}` and `[ebay] ...: failed for listingId=...` are marketplace API errors.
- `--errors` in `scripts/nr.ts` excludes only the `proxy_check` and `proxy_redirect_to_login` auth diagnostics, not every `[auth]` line.
- Node warnings such as `DeprecationWarning` are noise.

Lines logged before the logging agent was installed are not in New Relic; `kubectl logs` is the fallback for the last few minutes.

## Matching

- Contains text: `message LIKE '%needle%'` (case sensitive). Regex: `message RLIKE '(?i).*pattern.*'`.
- Escape a single quote in NRQL with a backslash (`\'`). Doubling it (`''`) is a syntax error. `scripts/nr.ts` already escapes `--grep` and `--ns` for you.
- Facet by a prefix to group repeated errors: `FACET substring(message, 0, 70)`.
