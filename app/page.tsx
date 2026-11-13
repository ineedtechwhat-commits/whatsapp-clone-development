import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { getWorkspaceData } from '@/lib/chat-service'
import { ChatApp } from './chat-app'

export default async function HomePage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const [workspace, cookieStore] = await Promise.all([getWorkspaceData(), cookies()])
  const initialTheme = cookieStore.get('morrow-theme')?.value === 'light' ? 'light' : 'dark'

  return <ChatApp initialData={workspace} initialTheme={initialTheme} />
}
