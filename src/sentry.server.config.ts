import * as Sentry from '@sentry/nextjs'
import { sharedSentryOptions } from './sentry-options'

Sentry.init({ ...sharedSentryOptions, dsn: process.env.SENTRY_DSN })
