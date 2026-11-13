import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { conversationMembers, conversations, messages } from '@/lib/db/schema'
import { getSessionUser } from '@/lib/auth-session'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const now = new Date()
  const rows = await db
    .select({
      id: conversations.id,
      lastMessageAt: sql<Date>`coalesce(max(${messages.createdAt}), ${conversations.updatedAt})`,
    })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .leftJoin(messages, and(
      eq(messages.conversationId, conversations.id),
      isNull(messages.deletedAt),
      or(isNull(messages.expiresAt), gt(messages.expiresAt, now)),
    ))
    .where(eq(conversationMembers.userId, user.id))
    .groupBy(conversations.id, conversations.updatedAt)
    .orderBy(desc(conversations.updatedAt))
    .limit(80)

  return NextResponse.json(rows.map((row) => ({
    id: row.id,
    lastMessageAt: row.lastMessageAt.toISOString(),
  })))
}
