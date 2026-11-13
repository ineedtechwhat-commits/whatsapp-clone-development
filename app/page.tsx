import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getRawSessionUser, getSessionUser } from '@/lib/admin-auth'
import { getWorkspaceData } from '@/lib/chat-service'
import { ChatApp } from './chat-app'

export default async function HomePage() {
  const rawUser = await getRawSessionUser()
  if (!rawUser) redirect('/sign-in')
  if (!(await getSessionUser())) redirect('/account-restricted')

  const [workspace, cookieStore] = await Promise.all([getWorkspaceData(), cookies()])
  const initialTheme = cookieStore.get('morrow-theme')?.value === 'light' ? 'light' : 'dark'

  return <ChatApp initialData={workspace} initialTheme={initialTheme} />
}
