'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { authClient, createGoogleAuthClient } from '@/lib/auth-client'

type AuthMode = 'sign-in' | 'sign-up'
type AuthStep = 'password' | 'verify-email' | 'forgot-password' | 'reset-password'
type PendingAction = 'google' | 'email' | 'verify' | 'resend' | 'reset-request' | 'reset-password' | null

export function AuthForm({ googleClientId }: { googleClientId: string }) {
  const router = useRouter()
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [step, setStep] = useState<AuthStep>('password')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [googleReady, setGoogleReady] = useState(false)
  const [googleSetupError, setGoogleSetupError] = useState(false)
  const googleButtonRef = useRef<HTMLDivElement>(null)
  const googleInitializedRef = useRef(false)
  const googleAuthClient = useMemo(() => createGoogleAuthClient(googleClientId), [googleClientId])

  async function signInWithGoogleRedirect() {
    setPendingAction('google')
    setError('')
    try {
      const result = await authClient.signIn.social({ provider: 'google', callbackURL: '/' })
      if (result.error) setError('Google sign-in could not be completed. Please try again.')
    } catch {
      setError('Google sign-in could not be completed. Please try again.')
    } finally {
      setPendingAction(null)
    }
  }

  useEffect(() => {
    const container = googleButtonRef.current
    if (!container || !googleClientId || googleInitializedRef.current) return

    googleInitializedRef.current = true
    void googleAuthClient.oneTap({
      button: {
        container,
        config: {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          width: Math.min(340, Math.max(220, Math.floor(container.clientWidth || 320))),
        },
      },
      fetchOptions: {
        onSuccess: () => {
          router.replace('/')
          router.refresh()
        },
        onError: () => setError('Google sign-in could not be completed. Please try again.'),
      },
    }).then(() => {
      setGoogleReady(true)
    }).catch(() => {
      setGoogleSetupError(true)
    })
  }, [googleAuthClient, googleClientId, router])

  async function requestEmailVerification(emailAddress: string) {
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({ email: emailAddress, type: 'email-verification' })
      if (result.error) throw new Error('Verification code could not be sent.')
    } catch {
      setError('Your email needs verification, but we could not send a code. Please try again in a moment.')
      return
    }

    setOtp('')
    setStep('verify-email')
    setNotice('Your email needs verification before sign-in. We sent you a verification code.')
  }

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPendingAction('email')
    setError('')
    setNotice('')

    const formData = new FormData(event.currentTarget)
    const submittedEmail = String(formData.get('email') ?? '').trim().toLowerCase()
    const password = String(formData.get('password') ?? '')
    setEmail(submittedEmail)

    try {
      const result = mode === 'sign-up'
        ? await authClient.signUp.email({
            name: String(formData.get('name') ?? '').trim(),
            email: submittedEmail,
            password,
          })
        : await authClient.signIn.email({ email: submittedEmail, password, callbackURL: '/' })

      if (result.error) {
        if (mode === 'sign-in' && result.error.code === 'EMAIL_NOT_VERIFIED') {
          await requestEmailVerification(submittedEmail)
          return
        }
        setError(mode === 'sign-up'
          ? 'We could not create your account. Check the details and try again.'
          : 'We could not sign you in. Check your details or reset your password.')
        return
      }

      if (mode === 'sign-up') {
        setOtp('')
        setStep('verify-email')
        setNotice('A verification code was sent to your email address.')
      } else {
        router.replace('/')
        router.refresh()
      }
    } catch {
      setError('We could not complete that request. Please try again.')
    } finally {
      setPendingAction(null)
    }
  }

  async function verifyEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPendingAction('verify')
    setError('')
    setNotice('')
    try {
      const result = await authClient.emailOtp.verifyEmail({ email, otp })
      if (result.error) {
        setError('That code could not be verified. Check it and try again.')
        return
      }
      setOtp('')
      setMode('sign-in')
      setStep('password')
      setNotice('Your email is verified. Sign in with your password to continue.')
    } catch {
      setError('We could not verify that code. Please try again.')
    } finally {
      setPendingAction(null)
    }
  }

  async function resendVerificationCode() {
    setPendingAction('resend')
    setError('')
    setNotice('')
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({ email, type: 'email-verification' })
      if (result.error) {
        setError('We could not send a new code. Please wait a moment and try again.')
        return
      }
      setNotice('A new verification code is on its way.')
    } catch {
      setError('We could not send a new code. Please wait a moment and try again.')
    } finally {
      setPendingAction(null)
    }
  }

  async function resendPasswordResetCode() {
    setPendingAction('resend')
    setError('')
    setNotice('')
    try {
      const result = await authClient.emailOtp.requestPasswordReset({ email })
      if (result.error) {
        setError('We could not send a new reset code. Please wait a moment and try again.')
        return
      }
      setNotice('A new reset code is on its way.')
    } catch {
      setError('We could not send a new reset code. Please wait a moment and try again.')
    } finally {
      setPendingAction(null)
    }
  }

  async function requestPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPendingAction('reset-request')
    setError('')
    setNotice('')
    const submittedEmail = String(new FormData(event.currentTarget).get('email') ?? '').trim().toLowerCase()
    setEmail(submittedEmail)
    try {
      const result = await authClient.emailOtp.requestPasswordReset({ email: submittedEmail })
      if (result.error) {
        setError('We could not send a reset code. Check the address and try again.')
        return
      }
      setOtp('')
      setStep('reset-password')
      setNotice('If an account exists for that address, a reset code is on its way.')
    } catch {
      setError('We could not send a reset code. Please try again.')
    } finally {
      setPendingAction(null)
    }
  }

  async function completePasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPendingAction('reset-password')
    setError('')
    setNotice('')
    const formData = new FormData(event.currentTarget)
    const password = String(formData.get('newPassword') ?? '')
    const confirmation = String(formData.get('confirmPassword') ?? '')
    if (password !== confirmation) {
      setError('The passwords do not match.')
      setPendingAction(null)
      return
    }

    try {
      const result = await authClient.emailOtp.resetPassword({ email, otp, password })
      if (result.error) {
        setError('That code could not reset your password. Check it and try again.')
        return
      }
      const signInResult = await authClient.signIn.email({ email, password, callbackURL: '/' })
      setOtp('')
      setMode('sign-in')

      if (!signInResult.error) {
        router.replace('/')
        router.refresh()
        return
      }

      if (signInResult.error.code === 'EMAIL_NOT_VERIFIED') {
        await requestEmailVerification(email)
        return
      }

      setStep('password')
      setNotice('Your password has been updated. We could not sign you in automatically, so please sign in with your new password.')
    } catch {
      setError('We could not reset your password. Please try again.')
    } finally {
      setPendingAction(null)
    }
  }

  const isPending = pendingAction !== null

  return (
    <div className="auth-action">
      {googleClientId && !googleSetupError ? (
        <div className="google-button-slot" aria-busy={!googleReady}>
          <div ref={googleButtonRef} />
          {!googleReady ? <span className="google-signin-loading" role="status">Preparing secure Google sign-in…</span> : null}
        </div>
      ) : (
        <button className="google-button" type="button" onClick={signInWithGoogleRedirect} disabled={isPending}>
          <span className="google-g" aria-hidden="true">G</span>
          {pendingAction === 'google' ? 'Connecting to Google…' : 'Continue with Google'}
        </button>
      )}

      <div className="auth-divider"><span>or use email</span></div>

      {step === 'password' ? (
        <>
          <div className="auth-mode-switch" role="group" aria-label="Account options">
            <button className="auth-mode-button" type="button" aria-pressed={mode === 'sign-in'} disabled={isPending} onClick={() => { setMode('sign-in'); setError(''); setNotice('') }}>Sign in</button>
            <button className="auth-mode-button" type="button" aria-pressed={mode === 'sign-up'} disabled={isPending} onClick={() => { setMode('sign-up'); if (!email) setEmail('whatwhenwhyyouwant@gmail.com'); setError(''); setNotice('') }}>Create account</button>
          </div>
          <form key="email" className="email-auth-form" onSubmit={handleEmailSubmit}>
            {mode === 'sign-up' ? (
              <label className="auth-field" htmlFor="auth-name">
                <span>Name</span>
                <input id="auth-name" name="name" type="text" autoComplete="name" placeholder="Your name" defaultValue="Vijay" maxLength={100} required disabled={isPending} />
              </label>
            ) : null}
            <label className="auth-field" htmlFor="auth-email">
              <span>Email address</span>
              <input id="auth-email" name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={isPending} />
            </label>
            <label className="auth-field" htmlFor="auth-password">
              <span>Password</span>
              <input id="auth-password" name="password" type="password" autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} minLength={8} maxLength={128} required disabled={isPending} />
            </label>
            <button className="email-submit" type="submit" disabled={isPending}>
              {pendingAction === 'email' ? mode === 'sign-up' ? 'Creating account…' : 'Signing in…' : mode === 'sign-up' ? 'Create account' : 'Sign in with email'}
            </button>
          </form>
          {mode === 'sign-in' ? <button className="auth-flow-link" type="button" onClick={() => { setStep('forgot-password'); setError(''); setNotice('') }}>Forgot password?</button> : null}
          <p className="auth-password-note">New accounts receive a six-digit verification code by email.</p>
        </>
      ) : null}

      {step === 'verify-email' ? (
        <form className="email-auth-form" onSubmit={verifyEmail}>
          <p className="auth-password-note">Enter the six-digit code sent to <strong>{email}</strong>. Codes expire after five minutes.</p>
          <label className="auth-field" htmlFor="auth-verify-code"><span>Email verification code</span><input id="auth-verify-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} required disabled={isPending} /></label>
          <button className="email-submit" type="submit" disabled={isPending || otp.length !== 6}>{pendingAction === 'verify' ? 'Verifying…' : 'Verify email'}</button>
          <button className="auth-flow-link" type="button" onClick={() => void resendVerificationCode()} disabled={isPending}>{pendingAction === 'resend' ? 'Sending…' : 'Resend code'}</button>
          <button className="auth-flow-link" type="button" onClick={() => { setStep('password'); setMode('sign-in'); setError(''); setNotice('') }} disabled={isPending}>Back to sign in</button>
        </form>
      ) : null}

      {step === 'forgot-password' ? (
        <form className="email-auth-form" onSubmit={requestPasswordReset}>
          <p className="auth-password-note">We&apos;ll send a one-time code if an account exists for that email address.</p>
          <label className="auth-field" htmlFor="reset-email"><span>Email address</span><input id="reset-email" name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} disabled={isPending} /></label>
          <button className="email-submit" type="submit" disabled={isPending}>{pendingAction === 'reset-request' ? 'Sending code…' : 'Send reset code'}</button>
          <button className="auth-flow-link" type="button" onClick={() => { setStep('password'); setError(''); setNotice('') }} disabled={isPending}>Back to sign in</button>
        </form>
      ) : null}

      {step === 'reset-password' ? (
        <form className="email-auth-form" onSubmit={completePasswordReset}>
          <p className="auth-password-note">Enter the code sent to <strong>{email}</strong> and choose a new password.</p>
          <label className="auth-field" htmlFor="reset-code"><span>Reset code</span><input id="reset-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} required disabled={isPending} /></label>
          <label className="auth-field" htmlFor="reset-password"><span>New password</span><input id="reset-password" name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={isPending} /></label>
          <label className="auth-field" htmlFor="reset-password-confirm"><span>Confirm new password</span><input id="reset-password-confirm" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={isPending} /></label>
          <button className="email-submit" type="submit" disabled={isPending || otp.length !== 6}>{pendingAction === 'reset-password' ? 'Updating password…' : 'Set new password'}</button>
          <button className="auth-flow-link" type="button" onClick={() => void resendPasswordResetCode()} disabled={isPending}>{pendingAction === 'resend' ? 'Sending…' : 'Resend code'}</button>
        </form>
      ) : null}

      {notice ? <p className="auth-form-notice" role="status">{notice}</p> : null}
      {error ? <p className="auth-form-error" role="alert">{error}</p> : null}
    </div>
  )
}
