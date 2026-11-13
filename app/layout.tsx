import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'F.R.I.E.N.D.S — chats, status, and profile cards',
  description: 'Private conversations, disappearing status updates, and customizable profile cards for your community.',
  applicationName: 'F.R.I.E.N.D.S',
  icons: {
    icon: [{ url: '/friends-wordmark.png', type: 'image/png' }],
    apple: '/friends-wordmark.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark light',
  themeColor: '#09150f',
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
