import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, or } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { conversationMembers, messageAttachments, messageReactions, messageReceipts, messages, userPresence, userProfiles, users } from '@/lib/db/schema'
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
  await db.insert(userPresence).values({ userId: user.id, lastActiveAt: now }).onConflictDoUpdate({
    target: userPresence.userId,
    set: { lastActiveAt: now },
  })
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
      pinnedAt: messages.pinnedAt,
      replyToMessageId: messages.replyToMessageId,
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

  const replyIds = Array.from(new Set(rows.flatMap((row) => row.replyToMessageId ? [row.replyToMessageId] : [])))
  const replyRows = replyIds.length
    ? await db.select({ id: messages.id, senderName: users.name, body: messages.body })
      .from(messages)
      .innerJoin(users, eq(users.id, messages.senderId))
      .where(and(
        eq(messages.conversationId, conversationId),
        inArray(messages.id, replyIds),
        isNull(messages.deletedAt),
        or(isNull(messages.expiresAt), gt(messages.expiresAt, now)),
      ))
    : []
  const repliesById = new Map(replyRows.map((row) => [row.id, { id: row.id, senderName: row.senderName, body: row.body.slice(0, 300) }]))

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

  const [preferences] = await db.select({ readReceipts: userProfiles.readReceipts }).from(userProfiles).where(eq(userProfiles.userId, user.id)).limit(1)
  const incomingRows = rows.filter((row) => row.senderId !== user.id)
  if (incomingRows.length) {
    const values = incomingRows.map((row) => ({
      id: `${row.id}:${user.id}`,
      messageId: row.id,
      conversationId,
      userId: user.id,
      deliveredAt: now,
      ...(preferences?.readReceipts ? { readAt: now } : {}),
    }))
    await db.insert(messageReceipts).values(values).onConflictDoUpdate({
      target: [messageReceipts.messageId, messageReceipts.userId],
      set: { deliveredAt: now, ...(preferences?.readReceipts ? { readAt: now } : {}) },
    })
  }

  const reactionRows = rows.length
    ? await db.select({ messageId: messageReactions.messageId, userId: messageReactions.userId, emoji: messageReactions.emoji }).from(messageReactions)
      .where(inArray(messageReactions.messageId, rows.map((row) => row.id)))
    : []
  const receiptRows = rows.length
    ? await db.select({ messageId: messageReceipts.messageId, deliveredAt: messageReceipts.deliveredAt, readAt: messageReceipts.readAt }).from(messageReceipts)
      .where(and(inArray(messageReceipts.messageId, rows.map((row) => row.id)), ne(messageReceipts.userId, user.id)))
    : []
  const reactionsByMessage = new Map<string, Map<string, { count: number; reacted: boolean }>>()
  for (const reaction of reactionRows) {
    const byEmoji = reactionsByMessage.get(reaction.messageId) ?? new Map()
    const current = byEmoji.get(reaction.emoji) ?? { count: 0, reacted: false }
    current.count += 1
    current.reacted ||= reaction.userId === user.id
    byEmoji.set(reaction.emoji, current)
    reactionsByMessage.set(reaction.messageId, byEmoji)
  }
  const receiptsByMessage = new Map<string, { deliveryCount: number; readCount: number }>()
  for (const receipt of receiptRows) {
    const current = receiptsByMessage.get(receipt.messageId) ?? { deliveryCount: 0, readCount: 0 }
    if (receipt.deliveredAt) current.deliveryCount += 1
    if (receipt.readAt) current.readCount += 1
    receiptsByMessage.set(receipt.messageId, current)
  }

  await db
    .update(conversationMembers)
    .set({ lastReadAt: now })
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, user.id)))

  return NextResponse.json(rows.reverse().map((row) => ({
    ...row,
    senderImage: profileImageUrl(row.senderImage, row.senderId),
    replyTo: row.replyToMessageId ? repliesById.get(row.replyToMessageId) ?? null : null,
    attachments: (attachmentsByMessage.get(row.id) ?? []).map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
      url: `/api/media?pathname=${encodeURIComponent(attachment.pathname)}`,
    })),
    reactions: Array.from(reactionsByMessage.get(row.id)?.entries() ?? []).map(([emoji, reaction]) => ({ emoji, ...reaction })),
    deliveryCount: receiptsByMessage.get(row.id)?.deliveryCount ?? 0,
    readCount: receiptsByMessage.get(row.id)?.readCount ?? 0,
    pinnedAt: row.pinnedAt?.toISOString() ?? null,
    replyToMessageId: row.replyToMessageId,
  })))
}
