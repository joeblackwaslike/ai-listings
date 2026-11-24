import type { BrowserOptions } from '@sentry/nextjs'

export const sharedSentryOptions: BrowserOptions = {
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  tracePropagationTargets: [],
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    databaseQueryData: false,
    stackFrameVariables: false,
  },
}
