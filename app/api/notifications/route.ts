import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { notifications } from '@/lib/db/schema'
import { getSessionUser } from '@/lib/auth-session'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const rows = await db.select({ id: notifications.id, type: notifications.type, conversationId: notifications.conversationId, messageId: notifications.messageId, title: notifications.title, body: notifications.body, readAt: notifications.readAt, createdAt: notifications.createdAt })
    .from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)).limit(30)
  return NextResponse.json(rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), readAt: row.readAt?.toISOString() ?? null })), { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { ids?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const now = new Date()
  if (!Array.isArray(body.ids) || body.ids.length > 100 || body.ids.some((id) => typeof id !== 'string' || id.length > 80)) {
    return NextResponse.json({ error: 'Invalid notification list' }, { status: 400 })
  }
  const ids = body.ids as string[]
  const scope = ids.length ? inArray(notifications.id, ids) : isNull(notifications.readAt)
  await db.update(notifications).set({ readAt: now }).where(and(eq(notifications.userId, user.id), scope))
  return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}
