# Log schema

Logs are collected by Fluent Bit and stored as the `Log` event type. The cluster runs in low-data mode, so only these attributes exist:

| Attribute | Meaning |
| --- | --- |
| `namespace_name` | Kubernetes namespace (`ai-listings`, `sup-ai-listings`, `github-runner`, ...) |
| `container_name` | Container, not deployment (`ai-listings`, `inngest`, `supabase-auth`, ...) |
| `pod_name`, `node_name` | Pod and node that produced the line |
| `stream` | `stdout` or `stderr` |
| `message` | The raw line, plain text |
| `timestamp` | Epoch milliseconds |

There is no `level` attribute. Severity has to be matched from the text.

## App line shapes (container `ai-listings`)

- `[auth] {"ts":...,"event":"proxy_check",...}` is a per-request auth diagnostic. About 96% of volume. `getUserError` with `AuthSessionMissingError` is normal for logged-out requests.
- `[sync-platform-messages] error for platform=ebay userId=...` and `[sync-platform-orders] error for platform=...` are real failures from the Inngest polling functions.
- `[ebay] API error body: {...}` and `[ebay] ...: failed for listingId=...` are marketplace API errors.
- Node warnings such as `DeprecationWarning` are noise.

## Matching

- Contains text: `message LIKE '%needle%'` (case sensitive). Regex: `message RLIKE '(?i).*pattern.*'`.
- Escape a single quote in NRQL by doubling it.
- Facet by a prefix to group repeated errors: `FACET substring(message, 0, 70)`.
