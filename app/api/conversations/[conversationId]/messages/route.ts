import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { conversationMembers, messageAttachments, messages, users } from '@/lib/db/schema'
import { getSessionUser } from '@/lib/auth-session'
import { profileImageUrl } from '@/lib/media'

export async function GET(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { conversationId } = await context.params
  const [membership] = await db
    .select({ id: conversationMembers.id })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, user.id)))
    .limit(1)

  if (!membership) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  const now = new Date()
  await db.delete(messages).where(and(
    eq(messages.conversationId, conversationId),
    isNotNull(messages.expiresAt),
    lte(messages.expiresAt, now),
  ))

  const rows = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      senderId: messages.senderId,
      senderName: users.name,
      senderImage: users.image,
      body: messages.body,
      createdAt: messages.createdAt,
      editedAt: messages.editedAt,
    })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.senderId))
    .where(and(
      eq(messages.conversationId, conversationId),
      isNull(messages.deletedAt),
      or(isNull(messages.expiresAt), gt(messages.expiresAt, now)),
    ))
    .orderBy(desc(messages.createdAt))
    .limit(120)

  const attachmentRows = rows.length
    ? await db
        .select({
          id: messageAttachments.id,
          messageId: messageAttachments.messageId,
          filename: messageAttachments.filename,
          contentType: messageAttachments.contentType,
          size: messageAttachments.size,
          pathname: messageAttachments.pathname,
        })
        .from(messageAttachments)
        .where(inArray(messageAttachments.messageId, rows.map((row) => row.id)))
        .orderBy(asc(messageAttachments.createdAt))
    : []
  const attachmentsByMessage = new Map<string, typeof attachmentRows>()
  for (const attachment of attachmentRows) {
    const current = attachmentsByMessage.get(attachment.messageId) ?? []
    current.push(attachment)
    attachmentsByMessage.set(attachment.messageId, current)
  }

  await db
    .update(conversationMembers)
    .set({ lastReadAt: now })
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, user.id)))

  return NextResponse.json(rows.reverse().map((row) => ({
    ...row,
    senderImage: profileImageUrl(row.senderImage, row.senderId),
    attachments: (attachmentsByMessage.get(row.id) ?? []).map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
      url: `/api/media?pathname=${encodeURIComponent(attachment.pathname)}`,
    })),
  })))
}
