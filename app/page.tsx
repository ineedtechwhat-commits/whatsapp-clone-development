import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getRawSessionUser, getSessionUser } from '@/lib/admin-auth'
import { getWorkspaceData } from '@/lib/chat-service'
import { ChatApp } from './chat-app'
import type { AppTheme } from '@/lib/chat-types'

export default async function HomePage() {
  const rawUser = await getRawSessionUser()
  if (!rawUser) redirect('/sign-in')
  if (!(await getSessionUser())) redirect('/account-restricted')

  const [workspace, cookieStore] = await Promise.all([getWorkspaceData(), cookies()])
  const savedTheme = cookieStore.get('morrow-theme')?.value
  const initialTheme: AppTheme = savedTheme === 'light' || savedTheme === 'central' || savedTheme === 'midnight' ? savedTheme : 'dark'

  return <ChatApp initialData={workspace} initialTheme={initialTheme} />
}
