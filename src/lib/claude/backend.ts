/**
 * Global, deployment-level switch between the two Claude call backends.
 *
 * `CLAUDE_CODE_OAUTH_TOKEN` set means the deployment has a Claude subscription
 * token (from `claude setup-token`) and should route every call through the
 * Agent SDK instead of the pay-per-token Messages API — this supersedes the
 * per-user `apiKeys.anthropic` threading from `getUserApiKeys()` for every
 * listing/user on the deployment. Unset (the default today) preserves the
 * existing per-user-key behavior via the api-key backend.
 */
export function getClaudeBackend(): 'oauth' | 'api-key' {
  return process.env.CLAUDE_CODE_OAUTH_TOKEN ? 'oauth' : 'api-key'
}
