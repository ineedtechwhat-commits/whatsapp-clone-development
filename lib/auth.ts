import { betterAuth } from 'better-auth'
import { waitUntil } from '@vercel/functions'
import { emailOTP, oneTap } from 'better-auth/plugins'
import { eq } from 'drizzle-orm'
import { db, pool } from '@/lib/db'
import { userProfiles, users } from '@/lib/db/schema'
import { sendEmailOtp, sendSecurityNotification } from '@/lib/email'

function normalizeOrigin(value?: string) {
  if (!value) return null
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).origin
  } catch {
    return null
  }
}

function publicOrigin(value?: string) {
  const origin = normalizeOrigin(value)
  if (!origin) return null
  const hostname = new URL(origin).hostname
  return ['localhost', '127.0.0.1', '::1'].includes(hostname) ? null : origin
}

const vercelOrigin =
  process.env.VERCEL_ENV === 'production'
    ? publicOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL) ?? publicOrigin(process.env.VERCEL_URL)
    : publicOrigin(process.env.VERCEL_BRANCH_URL) ?? publicOrigin(process.env.VERCEL_URL)

const authBaseURL =
  normalizeOrigin(process.env.BETTER_AUTH_URL) ??
  publicOrigin(process.env.V0_RUNTIME_URL) ??
  vercelOrigin ??
  'https://whatsapp-clone-development.v0.build'

export const auth = betterAuth({
  database: pool,
  baseURL: authBaseURL,
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    requireEmailVerification: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      redirectURI: `${authBaseURL}/api/auth/callback/google`,
    },
  },
  plugins: [
    oneTap({ clientId: process.env.GOOGLE_CLIENT_ID! }),
    emailOTP({
      otpLength: 6,
      expiresIn: 300,
      allowedAttempts: 5,
      sendVerificationOnSignUp: true,
      async sendVerificationOTP({ email, otp, type }) {
        await sendEmailOtp({ email, otp, type })
      },
    }),
  ],
  trustedOrigins: [
    ...(process.env.NODE_ENV === 'development'
      ? [
          'http://localhost:3000',
          ...(process.env.V0_RUNTIME_URL ? [process.env.V0_RUNTIME_URL] : []),
          ...(process.env.V0_DEV_APP_URL ? [process.env.V0_DEV_APP_URL] : []),
          ...(process.env.V0_BUILD_URL ? [process.env.V0_BUILD_URL] : []),
          ...(process.env.V0_SANDBOX_URL ? [process.env.V0_SANDBOX_URL] : []),
        ]
      : []),
    ...(process.env.NODE_ENV === 'production'
      ? [
          ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
          ...(process.env.VERCEL_PROJECT_PRODUCTION_URL
            ? [`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`]
            : []),
        ]
      : []),
  ],
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          waitUntil((async () => {
            const [profile] = await db.select({ securityNotifications: userProfiles.securityNotifications })
              .from(userProfiles).where(eq(userProfiles.userId, session.userId)).limit(1)
            if (profile?.securityNotifications === false) return
            const [user] = await db.select({ email: users.email, name: users.name })
              .from(users).where(eq(users.id, session.userId)).limit(1)
            if (user) await sendSecurityNotification(user)
          })().catch(() => {
            console.error('A sign-in security email could not be delivered.')
          }))
        },
      },
    },
  },
  ...(process.env.NODE_ENV === 'development'
    ? {
        advanced: {
          defaultCookieAttributes: {
            sameSite: 'none' as const,
            secure: true,
          },
        },
      }
    : {}),
})
