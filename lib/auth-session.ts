import { headers } from 'next/headers'
import { auth } from '@/lib/auth'

export async function getSessionUser() {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user ?? null
}
