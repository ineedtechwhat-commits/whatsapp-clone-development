'use client'

import { createAuthClient } from 'better-auth/react'
import { emailOTPClient, oneTapClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({ plugins: [emailOTPClient()] })

export function createGoogleAuthClient(clientId: string) {
  return createAuthClient({
    plugins: [oneTapClient({ clientId, uxMode: 'popup' })],
  })
}
