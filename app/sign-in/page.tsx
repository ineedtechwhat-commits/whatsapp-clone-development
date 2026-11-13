import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { BrandMark } from '@/components/brand-mark'
import { AuthForm } from './auth-form'

export default async function SignInPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (session?.user) redirect('/')

  return (
    <main className="auth-screen">
      <div className="auth-layout">
        <section className="auth-story" aria-labelledby="story-title">
          <a className="brand-lockup" href="/" aria-label="F.R.I.E.N.D.S home">
            <BrandMark className="brand-mark" />
            <span>F.R.I.E.N.D.S</span>
          </a>
          <div className="auth-story-copy">
            <p className="auth-story-kicker"><span aria-hidden="true" />A calmer corner of your day</p>
            <h1 id="story-title">Closer, in all the small moments.</h1>
            <p>A thoughtful space for the people who make your world feel a little more like home.</p>
          </div>
          <div className="auth-preview" aria-hidden="true">
            <div className="preview-orbit preview-orbit-one" />
            <div className="preview-orbit preview-orbit-two" />
            <div className="preview-chat-card">
              <div className="preview-card-topline"><span>your circle</span><span className="preview-presence"><i /> 3 around</span></div>
              <div className="preview-person"><span className="preview-avatar">J</span><span><strong>Jamie</strong><small>Sunday · 10:42 AM</small></span></div>
              <div className="preview-bubble preview-bubble-in">Found our new weekend spot.</div>
              <div className="preview-bubble preview-bubble-out">Already saved it. Coffee is on me.</div>
              <div className="preview-card-bottom"><span>A little closer, every day</span><span className="preview-spark" /></div>
            </div>
            <div className="preview-float-note"><span className="preview-note-icon" /><span><strong>Your people, your pace</strong><small>Just between you</small></span></div>
          </div>
        </section>

        <section className="auth-panel" aria-labelledby="auth-title">
          <div className="auth-card">
            <div className="auth-card-header">
              <p className="auth-card-kicker">YOUR PRIVATE MESSAGING SPACE</p>
              <h2 id="auth-title">Stay close to your people.</h2>
              <p>Sign in or create your F.R.I.E.N.D.S account to continue.</p>
            </div>
            <AuthForm googleClientId={process.env.GOOGLE_CLIENT_ID ?? ''} />
            <div className="auth-footnote">
              <span className="privacy-mark" aria-hidden="true">✓</span>
              <span>Thoughtful conversations, kept private.</span>
            </div>
          </div>
          <footer className="auth-footer">By continuing, you agree to use F.R.I.E.N.D.S thoughtfully and kindly.</footer>
        </section>
      </div>
    </main>
  )
}
