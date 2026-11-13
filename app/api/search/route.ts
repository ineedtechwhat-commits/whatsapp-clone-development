import { and, desc, eq, gt, ilike, inArray, isNull, ne, or } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { blockedUsers, conversationMembers, conversations, messages, userProfiles, users } from '@/lib/db/schema'
import { getSessionUser } from '@/lib/auth-session'
import { profileImageUrl } from '@/lib/media'

export async function GET(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const params = new URL(request.url).searchParams
  const query = params.get('q')?.trim() ?? ''
  const kind = params.get('type')
  if (query.length < 2 || query.length > 80 || (kind !== 'people' && kind !== 'messages')) {
    return NextResponse.json({ error: 'Search needs two to eighty characters and a valid type.' }, { status: 400 })
  }
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`

  if (kind === 'people') {
    const directConversations = await db.select({ conversationId: conversationMembers.conversationId })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(and(eq(conversationMembers.userId, user.id), eq(conversations.isGroup, false)))
    const conversationIds = directConversations.map((row) => row.conversationId)
    if (!conversationIds.length) return NextResponse.json([])
    const contacts = await db.select({ conversationId: conversationMembers.conversationId, id: users.id })
      .from(conversationMembers)
      .innerJoin(users, eq(users.id, conversationMembers.userId))
      .where(and(inArray(conversationMembers.conversationId, conversationIds), ne(conversationMembers.userId, user.id)))
    const contactIds = Array.from(new Set(contacts.map((row) => row.id)))
    const blockedRows = await db.select({ blockerId: blockedUsers.blockerId, blockedUserId: blockedUsers.blockedUserId }).from(blockedUsers)
      .where(or(eq(blockedUsers.blockerId, user.id), eq(blockedUsers.blockedUserId, user.id)))
    const blockedIds = new Set(blockedRows.flatMap((row) => [row.blockerId, row.blockedUserId]))
    const visibleIds = contactIds.filter((id) => !blockedIds.has(id))
    if (!visibleIds.length) return NextResponse.json([])
    const rows = await db.select({ id: users.id, name: users.name, image: users.image, username: userProfiles.username, photoVisibility: userProfiles.profilePhotoVisibility })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(and(inArray(users.id, visibleIds), or(ilike(users.name, pattern), ilike(userProfiles.username, pattern))))
      .limit(20)
    const conversationByPerson = new Map(contacts.map((row) => [row.id, row.conversationId]))
    return NextResponse.json(rows.map((row) => ({ id: row.id, name: row.name, username: row.username ?? 'friend', image: row.photoVisibility === 'nobody' ? null : profileImageUrl(row.image, row.id), conversationId: conversationByPerson.get(row.id) })), { headers: { 'Cache-Control': 'private, no-store' } })
  }

  const memberships = await db.select({ conversationId: conversationMembers.conversationId })
    .from(conversationMembers).where(eq(conversationMembers.userId, user.id))
  const conversationIds = memberships.map((row) => row.conversationId)
  if (!conversationIds.length) return NextResponse.json([])
  const rows = await db.select({ id: messages.id, conversationId: messages.conversationId, body: messages.body, createdAt: messages.createdAt, senderName: users.name })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.senderId))
    .where(and(inArray(messages.conversationId, conversationIds), ilike(messages.body, pattern), isNull(messages.deletedAt), or(isNull(messages.expiresAt), gt(messages.expiresAt, new Date()))))
    .orderBy(desc(messages.createdAt))
    .limit(30)
  return NextResponse.json(rows.map((row) => {
    const matchIndex = row.body.toLowerCase().indexOf(query.toLowerCase())
    const start = Math.max(0, matchIndex - 45)
    const end = Math.min(row.body.length, matchIndex + query.length + 90)
    return { id: row.id, conversationId: row.conversationId, senderName: row.senderName, snippet: `${start ? '…' : ''}${row.body.slice(start, end)}${end < row.body.length ? '…' : ''}`, createdAt: row.createdAt.toISOString() }
  }), { headers: { 'Cache-Control': 'private, no-store' } })
}
