import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AdminDashboard } from '@/app/admin/admin-dashboard'
import { getAdminOverview } from '@/lib/admin-service'
import { getRawSessionUser, getUserAccessState } from '@/lib/admin-auth'

export const metadata = {
  title: 'Admin console | F.R.I.E.N.D.S',
  robots: { index: false, follow: false },
}

export default async function AdminPage() {
  const user = await getRawSessionUser()
  if (!user) redirect('/sign-in')

  const access = await getUserAccessState(user.id)
  if (!access.isAdmin) {
    if (access.isRestricted) redirect('/account-restricted')
    redirect('/')
  }

  const [overview, cookieStore] = await Promise.all([getAdminOverview(), cookies()])
  const initialTheme = cookieStore.get('morrow-theme')?.value === 'light' ? 'light' : 'dark'

  return <AdminDashboard initialOverview={overview} initialTheme={initialTheme} />
}
