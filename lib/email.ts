import { createTransport } from 'nodemailer'

type EmailOtpType = 'email-verification' | 'sign-in' | 'forget-password' | 'change-email'

const senderEmail = process.env.GMAIL_USER ?? 'whatwhenwhyyouwant@gmail.com'

const emailCopy: Record<EmailOtpType, { subject: string; title: string; message: string }> = {
  'email-verification': {
    subject: 'Verify your email for F.R.I.E.N.D.S',
    title: 'Confirm your email',
    message: 'Enter this code in F.R.I.E.N.D.S to finish creating your account.',
  },
  'sign-in': {
    subject: 'Your F.R.I.E.N.D.S sign-in code',
    title: 'Sign in securely',
    message: 'Use this one-time code to sign in to your F.R.I.E.N.D.S account.',
  },
  'forget-password': {
    subject: 'Reset your F.R.I.E.N.D.S password',
    title: 'Reset your password',
    message: 'Enter this code in F.R.I.E.N.D.S to choose a new password.',
  },
  'change-email': {
    subject: 'Confirm your new F.R.I.E.N.D.S email',
    title: 'Confirm your new email',
    message: 'Enter this code in F.R.I.E.N.D.S to verify your new email address.',
  },
}

function createMailer() {
  const appPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, '')
  if (!appPassword) throw new Error('Gmail SMTP is not configured.')
  return createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: senderEmail, pass: appPassword },
  })
}

export async function sendSecurityNotification({ email, name }: { email: string; name: string }) {
  const transporter = createMailer()
  await transporter.sendMail({
    from: { name: 'F.R.I.E.N.D.S', address: senderEmail },
    to: email,
    subject: 'New sign-in to your F.R.I.E.N.D.S account',
    text: `Hi ${name}, a new sign-in to your F.R.I.E.N.D.S account was just completed. If this was not you, reset your password and review your account settings.`,
    html: `<!doctype html><html><body style="margin:0;background:#f1f5f2;font-family:Arial,sans-serif;color:#13231d"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border:1px solid #dfe9e3;border-radius:20px;overflow:hidden"><tr><td style="padding:24px 30px;background:#075e54;color:#fff"><div style="font-size:12px;font-weight:700;letter-spacing:2px">F.R.I.E.N.D.S SECURITY</div><div style="margin-top:8px;font-size:24px;font-weight:700">New sign-in detected</div></td></tr><tr><td style="padding:30px"><p style="margin:0;color:#51645b;font-size:15px;line-height:1.6">Hi ${name.replace(/[<>]/g, '')}, a new sign-in to your account was just completed.</p><p style="margin:20px 0 0;color:#718078;font-size:13px;line-height:1.6">If this was not you, reset your password and review your account settings. You can safely ignore this message if you recognize the activity.</p></td></tr></table></td></tr></table></body></html>`,
  })
}

export async function sendEmailOtp({ email, otp, type }: { email: string; otp: string; type: EmailOtpType }) {
  const copy = emailCopy[type]
  const safeOtp = otp.replace(/\D/g, '')
  const transporter = createMailer()

  await transporter.sendMail({
    from: { name: 'F.R.I.E.N.D.S', address: senderEmail },
    to: email,
    subject: copy.subject,
    text: `${copy.title}\n\n${copy.message}\n\n${safeOtp}\n\nThis code expires in 5 minutes. If you did not request it, you can ignore this email.`,
    html: `<!doctype html><html><body style="margin:0;background:#f1f5f2;font-family:Arial,sans-serif;color:#13231d"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border:1px solid #dfe9e3;border-radius:20px;overflow:hidden"><tr><td style="padding:24px 30px;background:#075e54;color:#fff"><div style="font-size:12px;font-weight:700;letter-spacing:2px">F.R.I.E.N.D.S</div><div style="margin-top:8px;font-size:25px;font-weight:700">${copy.title}</div></td></tr><tr><td style="padding:30px"><p style="margin:0 0 20px;color:#51645b;font-size:15px;line-height:1.6">${copy.message}</p><div style="padding:18px 12px;border:1px solid #dce9e0;border-radius:14px;background:#f6faf7;color:#075e54;font-size:32px;font-weight:700;letter-spacing:9px;text-align:center">${safeOtp}</div><p style="margin:17px 0 0;color:#718078;font-size:13px">This code expires in 5 minutes.</p><p style="margin:24px 0 0;color:#8b9690;font-size:12px;line-height:1.5">If you did not request this code, you can safely ignore this email.</p></td></tr></table></td></tr></table></body></html>`,
  })
}
