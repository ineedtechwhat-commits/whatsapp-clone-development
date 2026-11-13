import { and, eq, gt, ne } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { conversationMembers, conversationTyping, userPresence, userProfiles, users } from '@/lib/db/schema'
import { getSessionUser } from '@/lib/auth-session'

export async function GET(_request: Request, context: { params: Promise<{ conversationId: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { conversationId } = await context.params
  const [membership] = await db.select({ id: conversationMembers.id }).from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, user.id))).limit(1)
  if (!membership) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  const now = new Date()
  await db.insert(userPresence).values({ userId: user.id, lastActiveAt: now }).onConflictDoUpdate({ target: userPresence.userId, set: { lastActiveAt: now } })
  const [typingRows, onlineRows] = await Promise.all([
    db.select({ name: users.name }).from(conversationTyping)
      .innerJoin(users, eq(users.id, conversationTyping.userId))
      .where(and(eq(conversationTyping.conversationId, conversationId), gt(conversationTyping.expiresAt, now), ne(conversationTyping.userId, user.id))),
    db.select({ userId: userPresence.userId }).from(conversationMembers)
      .innerJoin(userPresence, eq(userPresence.userId, conversationMembers.userId))
      .leftJoin(userProfiles, eq(userProfiles.userId, conversationMembers.userId))
      .where(and(eq(conversationMembers.conversationId, conversationId), ne(conversationMembers.userId, user.id), gt(userPresence.lastActiveAt, new Date(now.getTime() - 60_000)), ne(userProfiles.lastSeenVisibility, 'nobody'))),
  ])
  return NextResponse.json({ typingNames: typingRows.map((row) => row.name), onlineUserIds: onlineRows.map((row) => row.userId) }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(request: Request, context: { params: Promise<{ conversationId: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { conversationId } = await context.params
  const [membership] = await db.select({ id: conversationMembers.id }).from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, user.id))).limit(1)
  if (!membership) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  let body: { typing?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  if (typeof body.typing !== 'boolean') return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  if (body.typing) {
    await db.insert(conversationTyping).values({ id: crypto.randomUUID(), conversationId, userId: user.id, expiresAt: new Date(Date.now() + 8_000) })
      .onConflictDoUpdate({ target: [conversationTyping.conversationId, conversationTyping.userId], set: { expiresAt: new Date(Date.now() + 8_000) } })
  } else {
    await db.delete(conversationTyping).where(and(eq(conversationTyping.conversationId, conversationId), eq(conversationTyping.userId, user.id)))
  }
  return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}
