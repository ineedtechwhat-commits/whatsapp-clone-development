import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'F.R.I.E.N.D.S — private chats and group messages',
  description: 'Private direct and group chats with emoji, file attachments, and photo or video status updates that disappear after 24 hours.',
  applicationName: 'F.R.I.E.N.D.S',
  icons: {
    icon: [{ url: '/friends-app-icon.png', type: 'image/png' }],
    apple: '/friends-app-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark light',
  themeColor: '#0b141a',
  width: 'device-width',
  initialScale: 1,
  userScalable: true,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
