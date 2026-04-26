export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const { reason } = await searchParams

  const messages: Record<string, string> = {
    not_allowed: 'Your email address is not on the allowed list.',
    closed: 'Registration is currently closed.',
    exchange_failed: 'Something went wrong during sign-in. Please try again.',
    no_code: 'Invalid sign-in link. Please try again.',
    no_user: 'Could not retrieve your account after sign-in. Please try again.',
  }

  const message = messages[reason ?? ''] ?? 'An unexpected error occurred during sign-in.'

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center space-y-4 max-w-sm px-6">
        <h1 className="text-xl font-semibold text-gray-100">Sign-in failed</h1>
        <p className="text-sm text-gray-500">{message}</p>
        <a href="/login" className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
          Try again →
        </a>
      </div>
    </div>
  )
}
