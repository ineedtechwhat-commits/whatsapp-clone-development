import { redirect } from 'next/navigation'
import { getRawSessionUser, getSessionUser } from '@/lib/admin-auth'

export default async function AccountRestrictedPage() {
  const user = await getRawSessionUser()
  if (!user) redirect('/sign-in')
  if (await getSessionUser()) redirect('/')

  return (
    <main className="restricted-screen">
      <section className="restricted-card" aria-labelledby="restricted-title">
        <p className="inbox-kicker">F.R.I.E.N.D.S ACCOUNT</p>
        <h1 id="restricted-title">Access is temporarily unavailable</h1>
        <p>Your account has an active restriction. If you believe this is a mistake, contact the F.R.I.E.N.D.S support team.</p>
      </section>
    </main>
  )
}
