import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { conversationMembers, conversations, userProfiles, users } from '@/lib/db/schema'
import { getSessionUser } from '@/lib/auth-session'
import { profileImageUrl } from '@/lib/media'

export async function GET(_request: Request, context: { params: Promise<{ conversationId: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { conversationId } = await context.params
  const [membership] = await db.select({ id: conversationMembers.id }).from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, user.id), eq(conversations.isGroup, true))).limit(1)
  if (!membership) return NextResponse.json({ error: 'Group not found' }, { status: 404 })
  const rows = await db.select({ id: conversationMembers.userId, name: users.name, image: users.image, role: conversationMembers.role, joinedAt: conversationMembers.joinedAt, photoVisibility: userProfiles.profilePhotoVisibility })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(eq(conversationMembers.conversationId, conversationId))
    .orderBy(conversationMembers.joinedAt)
  return NextResponse.json(rows.map((row) => ({ id: row.id, name: row.name, image: row.photoVisibility === 'nobody' ? null : profileImageUrl(row.image, row.id), role: row.role === 'admin' ? 'admin' : 'member', joinedAt: row.joinedAt.toISOString() })), { headers: { 'Cache-Control': 'private, no-store' } })
}
