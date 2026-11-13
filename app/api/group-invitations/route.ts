import { and, desc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { conversations, groupInvitations, users } from '@/lib/db/schema'
import { getSessionUser } from '@/lib/auth-session'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const rows = await db.select({ id: groupInvitations.id, conversationId: groupInvitations.conversationId, inviterName: users.name, groupName: conversations.title, createdAt: groupInvitations.createdAt })
    .from(groupInvitations)
    .innerJoin(conversations, eq(conversations.id, groupInvitations.conversationId))
    .innerJoin(users, eq(users.id, groupInvitations.inviterId))
    .where(and(eq(groupInvitations.inviteeId, user.id), eq(groupInvitations.status, 'pending')))
    .orderBy(desc(groupInvitations.createdAt))
    .limit(20)
  return NextResponse.json(rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })), { headers: { 'Cache-Control': 'private, no-store' } })
}
