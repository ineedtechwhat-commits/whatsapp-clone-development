'use server'

import { del, head } from '@vercel/blob'
import { randomUUID } from 'node:crypto'
import { and, asc, eq, gt, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  accounts,
  adminControlRecords,
  conversationMembers,
  conversations,
  messages,
  messageAttachments,
  sessions,
  statuses,
  userProfiles,
  users,
  verifications,
  messageReactions,
  messageReceipts,
  conversationTyping,
  notifications,
  blockedUsers,
  groupInvitations,
} from '@/lib/db/schema'
import { getSessionUser } from '@/lib/auth-session'
import { isAdminUserId } from '@/lib/admin-auth'
import type { AvatarDecoration, ChatPreferences, MessageTimer, Visibility } from '@/lib/chat-types'
import { isProfilePhotoPathname, MAX_CHAT_ATTACHMENTS, MAX_CHAT_FILE_BYTES, MAX_PROFILE_BANNER_BYTES, MAX_PROFILE_PHOTO_BYTES, MAX_STATUS_FILE_BYTES, PROFILE_PHOTO_TYPES, STATUS_MEDIA_TYPES, safeDisplayName } from '@/lib/media'

async function requireUserId() {
  const user = await getSessionUser()
  if (!user) throw new Error('Unauthorized')
  return user.id
}

async function notifyMessageRecipients(conversationId: string, senderId: string, body: string) {
  const [conversation, sender] = await Promise.all([
    db.select({ title: conversations.title, isGroup: conversations.isGroup }).from(conversations).where(eq(conversations.id, conversationId)).limit(1),
    db.select({ name: users.name }).from(users).where(eq(users.id, senderId)).limit(1),
  ])
  const members = await db.select({ userId: conversationMembers.userId, username: userProfiles.username, notifyMessages: userProfiles.notifyMessages, notifyGroupMessages: userProfiles.notifyGroupMessages, notifyMentions: userProfiles.notifyMentions })
    .from(conversationMembers)
    .leftJoin(userProfiles, eq(userProfiles.userId, conversationMembers.userId))
    .where(and(eq(conversationMembers.conversationId, conversationId), ne(conversationMembers.userId, senderId)))
  const mutedPairs = members.length
    ? await db.select({ blockerId: blockedUsers.blockerId, blockedUserId: blockedUsers.blockedUserId }).from(blockedUsers)
      .where(or(
        and(eq(blockedUsers.blockerId, senderId), inArray(blockedUsers.blockedUserId, members.map((member) => member.userId))),
        and(eq(blockedUsers.blockedUserId, senderId), inArray(blockedUsers.blockerId, members.map((member) => member.userId))),
      ))
    : []
  const blockedIds = new Set(mutedPairs.flatMap((pair) => [pair.blockerId, pair.blockedUserId]))
  const group = conversation[0]?.isGroup ?? false
  const mentions = new Set(Array.from(body.matchAll(/@([a-zA-Z0-9_]{1,24})/g), (match) => match[1].toLowerCase()))
  const rows = members.flatMap((member) => {
    if (blockedIds.has(member.userId)) return []
    const mentioned = Boolean(member.username && mentions.has(member.username.toLowerCase()))
    if (mentioned && member.notifyMentions !== false) return [{
      id: randomUUID(), userId: member.userId, type: 'mention', actorUserId: senderId, conversationId,
      title: 'You were mentioned', body: body.slice(0, 180),
    }]
    if (group ? member.notifyGroupMessages === false : member.notifyMessages === false) return []
    return [{
      id: randomUUID(), userId: member.userId, type: group ? 'group_message' : 'message', actorUserId: senderId,
      conversationId, title: group ? conversation[0]?.title || 'New group message' : sender[0]?.name || 'New message', body: body.slice(0, 180),
    }]
  })
  if (rows.length) await db.insert(notifications).values(rows)
}

async function ensureConversationNotBlocked(conversationId: string, userId: string) {
  const [conversation] = await db.select({ isGroup: conversations.isGroup }).from(conversations).where(eq(conversations.id, conversationId)).limit(1)
  if (conversation?.isGroup) return
  const others = await db.select({ userId: conversationMembers.userId }).from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), ne(conversationMembers.userId, userId)))
  if (!others.length) return
  const [blocked] = await db.select({ id: blockedUsers.id }).from(blockedUsers).where(or(
    and(eq(blockedUsers.blockerId, userId), inArray(blockedUsers.blockedUserId, others.map((item) => item.userId))),
    and(eq(blockedUsers.blockedUserId, userId), inArray(blockedUsers.blockerId, others.map((item) => item.userId))),
  )).limit(1)
  if (blocked) throw new Error('You cannot send messages in this conversation.')
}

export async function createConversationAction(emailInput: string) {
  const userId = await requireUserId()
  const email = emailInput.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address.')
  }

  const [recipient] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (!recipient || recipient.id === userId) {
    throw new Error('We could not start that conversation. Check the email address and try again.')
  }
  const [block] = await db.select({ id: blockedUsers.id }).from(blockedUsers).where(or(
    and(eq(blockedUsers.blockerId, userId), eq(blockedUsers.blockedUserId, recipient.id)),
    and(eq(blockedUsers.blockerId, recipient.id), eq(blockedUsers.blockedUserId, userId)),
  )).limit(1)
  if (block) throw new Error('This conversation is unavailable.')

  const existingMemberships = await db
    .select({ conversationId: conversationMembers.conversationId })
    .from(conversationMembers)
    .where(eq(conversationMembers.userId, userId))

  if (existingMemberships.length) {
    const [existingConversation] = await db
      .select({ conversationId: conversationMembers.conversationId })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(and(
        eq(conversationMembers.userId, recipient.id),
        eq(conversations.isGroup, false),
        inArray(conversationMembers.conversationId, existingMemberships.map((item) => item.conversationId)),
      ))
      .limit(1)
    if (existingConversation) return existingConversation.conversationId
  }

  const conversationId = randomUUID()
  await db.transaction(async (tx) => {
    await tx.insert(conversations).values({ id: conversationId, createdBy: userId })
    await tx.insert(conversationMembers).values([
      { id: randomUUID(), conversationId, userId },
      { id: randomUUID(), conversationId, userId: recipient.id },
    ])
  })

  return conversationId
}

export async function createGroupConversationAction(titleInput: string, memberEmailsInput: string) {
  const userId = await requireUserId()
  const title = titleInput.trim()
  const emails = Array.from(new Set(memberEmailsInput
    .split(/[\s,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)))

  if (title.length < 2 || title.length > 80) throw new Error('Group names must be between 2 and 80 characters.')
  if (emails.length < 1 || emails.length > 99 || memberEmailsInput.length > 6000) {
    throw new Error('Add between 1 and 99 group members.')
  }
  if (emails.some((email) => email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error('Enter valid email addresses for every member.')
  }

  const recipients = await db
    .select({ id: users.id, groupInvitePolicy: userProfiles.groupInvitePolicy })
    .from(users)
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(inArray(users.email, emails))
  if (recipients.length !== emails.length || recipients.some((recipient) => recipient.id === userId)) {
    throw new Error('We could not create that group. Check the member addresses and try again.')
  }

  const restrictedRecipients = recipients.filter((recipient) => recipient.groupInvitePolicy === 'nobody' || recipient.groupInvitePolicy === 'contacts')
  if (restrictedRecipients.length) {
    const directChats = await db
      .select({ conversationId: conversationMembers.conversationId })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(and(eq(conversationMembers.userId, userId), eq(conversations.isGroup, false)))
    const directChatIds = directChats.map((chat) => chat.conversationId)
    const knownRecipients = directChatIds.length
      ? await db.select({ userId: conversationMembers.userId }).from(conversationMembers)
        .where(and(inArray(conversationMembers.conversationId, directChatIds), inArray(conversationMembers.userId, restrictedRecipients.map((recipient) => recipient.id))))
      : []
    const knownRecipientIds = new Set(knownRecipients.map((recipient) => recipient.userId))
    if (restrictedRecipients.some((recipient) => recipient.groupInvitePolicy === 'nobody' || !knownRecipientIds.has(recipient.id))) {
      throw new Error('One or more members only accept group invitations from their contacts.')
    }
  }

  const conversationId = randomUUID()
  await db.transaction(async (tx) => {
    await tx.insert(conversations).values({ id: conversationId, createdBy: userId, title, isGroup: true })
    await tx.insert(conversationMembers).values([
      { id: randomUUID(), conversationId, userId, role: 'admin' },
      ...recipients.map((recipient) => ({ id: randomUUID(), conversationId, userId: recipient.id, role: 'member' })),
    ])
  })

  return conversationId
}

async function getReplyToMessageId(conversationId: string, input: unknown): Promise<string | null> {
  if (input === undefined || input === null) return null
  if (typeof input !== 'string') throw new Error('The message you are replying to is no longer available.')
  const messageId = input.trim()
  if (!messageId) return null
  if (messageId.length > 80) throw new Error('The message you are replying to is no longer available.')
  const [message] = await db.select({ id: messages.id }).from(messages).where(and(
    eq(messages.id, messageId),
    eq(messages.conversationId, conversationId),
    isNull(messages.deletedAt),
    or(isNull(messages.expiresAt), gt(messages.expiresAt, new Date())),
  )).limit(1)
  if (!message) throw new Error('The message you are replying to is no longer available.')
  return message.id
}

export async function sendMessageAction(conversationId: string, bodyInput: string, replyToMessageIdInput?: string | null) {
  const userId = await requireUserId()
  const conversation = conversationId.trim()
  const body = bodyInput.trim()
  if (!conversation || conversation.length > 80) throw new Error('Conversation not found.')
  if (!body || body.length > 4000) throw new Error('Messages must be between 1 and 4,000 characters.')

  const [membership] = await db
    .select({ id: conversationMembers.id })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversation), eq(conversationMembers.userId, userId)))
    .limit(1)
  if (!membership) throw new Error('Conversation not found.')
  await ensureConversationNotBlocked(conversation, userId)
  const replyToMessageId = await getReplyToMessageId(conversation, replyToMessageIdInput)

  const [profile] = await db
    .select({ defaultMessageTimer: userProfiles.defaultMessageTimer })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1)

  const timerDurations: Record<MessageTimer, number> = {
    off: 0,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '90d': 90 * 24 * 60 * 60 * 1000,
  }
  const duration = timerDurations[(profile?.defaultMessageTimer as MessageTimer) ?? 'off'] ?? 0
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.insert(messages).values({
      id: randomUUID(),
      conversationId: conversation,
      senderId: userId,
      body,
      replyToMessageId,
      expiresAt: duration ? new Date(now.getTime() + duration) : null,
    })
    await tx.update(conversations).set({ updatedAt: now }).where(eq(conversations.id, conversation))
  })
  await notifyMessageRecipients(conversation, userId, body).catch(() => undefined)
  await db.delete(conversationTyping).where(and(eq(conversationTyping.conversationId, conversation), eq(conversationTyping.userId, userId)))
}

type UploadedAttachmentInput = {
  pathname: string
  filename: string
}

export async function sendMessageWithAttachmentsAction(
  conversationIdInput: string,
  bodyInput: string,
  filesInput: UploadedAttachmentInput[],
  replyToMessageIdInput?: string | null,
) {
  const userId = await requireUserId()
  const conversationId = typeof conversationIdInput === 'string' ? conversationIdInput.trim() : ''
  const body = typeof bodyInput === 'string' ? bodyInput.trim() : ''
  const files = Array.isArray(filesInput) ? filesInput : []
  if (!conversationId || conversationId.length > 80) throw new Error('Conversation not found.')
  if (body.length > 4000 || (!body && !files.length)) throw new Error('Add a message or an attachment.')
  if (files.length > MAX_CHAT_ATTACHMENTS) throw new Error(`Send up to ${MAX_CHAT_ATTACHMENTS} files at a time.`)

  const [membership] = await db
    .select({ id: conversationMembers.id })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)))
    .limit(1)
  if (!membership) throw new Error('Conversation not found.')
  await ensureConversationNotBlocked(conversationId, userId)
  const replyToMessageId = await getReplyToMessageId(conversationId, replyToMessageIdInput)

  const expectedPrefix = `users/${userId}/messages/${conversationId}/`
  const seenPathnames = new Set<string>()
  const verifiedFiles = await Promise.all(files.map(async (file) => {
    if (
      !file ||
      typeof file.pathname !== 'string' ||
      typeof file.filename !== 'string' ||
      file.pathname.length > 512 ||
      !file.pathname.startsWith(expectedPrefix) ||
      file.pathname.slice(expectedPrefix.length).includes('/') ||
      seenPathnames.has(file.pathname)
    ) {
      throw new Error('One or more attachments could not be verified.')
    }
    seenPathnames.add(file.pathname)

    const metadata = await head(file.pathname)
    if (metadata.size > MAX_CHAT_FILE_BYTES) throw new Error('Each attachment must be 20 MB or smaller.')
    return {
      pathname: file.pathname,
      filename: safeDisplayName(file.filename),
      contentType: metadata.contentType || 'application/octet-stream',
      size: metadata.size,
    }
  }))

  const [profile] = await db
    .select({ defaultMessageTimer: userProfiles.defaultMessageTimer })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1)
  const timerDurations: Record<MessageTimer, number> = {
    off: 0,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '90d': 90 * 24 * 60 * 60 * 1000,
  }
  const now = new Date()
  const duration = timerDurations[(profile?.defaultMessageTimer as MessageTimer) ?? 'off'] ?? 0
  const messageId = randomUUID()
  const fallbackBody = verifiedFiles.length === 1 ? '📎 Attachment' : `📎 ${verifiedFiles.length} attachments`

  try {
    await db.transaction(async (tx) => {
      await tx.insert(messages).values({
        id: messageId,
        conversationId,
        senderId: userId,
        body: body || fallbackBody,
        replyToMessageId,
        expiresAt: duration ? new Date(now.getTime() + duration) : null,
      })
      if (verifiedFiles.length) {
        await tx.insert(messageAttachments).values(verifiedFiles.map((file) => ({
          id: randomUUID(),
          messageId,
          conversationId,
          uploadedBy: userId,
          ...file,
        })))
      }
      await tx.update(conversations).set({ updatedAt: now }).where(eq(conversations.id, conversationId))
    })
  } catch {
    if (verifiedFiles.length) await del(verifiedFiles.map((file) => file.pathname)).catch(() => undefined)
    throw new Error('Your message could not be sent. Please try again.')
  }
  await notifyMessageRecipients(conversationId, userId, body || fallbackBody).catch(() => undefined)
  await db.delete(conversationTyping).where(and(eq(conversationTyping.conversationId, conversationId), eq(conversationTyping.userId, userId)))
}

export async function editMessageAction(messageIdInput: string, bodyInput: string) {
  const userId = await requireUserId()
  const messageId = messageIdInput.trim()
  const body = bodyInput.trim()
  if (!messageId || messageId.length > 80 || !body || body.length > 4000) {
    throw new Error('Messages must be between 1 and 4,000 characters.')
  }

  const [message] = await db
    .select({ conversationId: messages.conversationId })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.senderId, userId), isNull(messages.deletedAt)))
    .limit(1)
  if (!message) throw new Error('Message not found.')

  const [membership] = await db
    .select({ id: conversationMembers.id })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, message.conversationId), eq(conversationMembers.userId, userId)))
    .limit(1)
  if (!membership) throw new Error('Message not found.')

  await db.update(messages)
    .set({ body, editedAt: new Date() })
    .where(and(eq(messages.id, messageId), eq(messages.senderId, userId), isNull(messages.deletedAt)))
}

export async function deleteMessageAction(messageIdInput: string) {
  const userId = await requireUserId()
  const messageId = messageIdInput.trim()
  if (!messageId || messageId.length > 80) throw new Error('Message not found.')

  const [message] = await db
    .select({ conversationId: messages.conversationId })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.senderId, userId), isNull(messages.deletedAt)))
    .limit(1)
  if (!message) throw new Error('Message not found.')

  const [membership] = await db
    .select({ id: conversationMembers.id })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, message.conversationId), eq(conversationMembers.userId, userId)))
    .limit(1)
  if (!membership) throw new Error('Message not found.')

  const attachmentRows = await db
    .select({ pathname: messageAttachments.pathname })
    .from(messageAttachments)
    .where(eq(messageAttachments.messageId, messageId))
  await db.transaction(async (tx) => {
    await tx.update(messages)
      .set({ deletedAt: new Date() })
      .where(and(eq(messages.id, messageId), eq(messages.senderId, userId), isNull(messages.deletedAt)))
    await tx.delete(messageAttachments).where(eq(messageAttachments.messageId, messageId))
  })
  if (attachmentRows.length) await del(attachmentRows.map((attachment) => attachment.pathname)).catch(() => undefined)
}

export async function clearConversationAction(conversationIdInput: string) {
  const userId = await requireUserId()
  const conversationId = conversationIdInput.trim()
  if (!conversationId || conversationId.length > 80) throw new Error('Conversation not found.')

  let removedPathnames: string[] = []
  await db.transaction(async (tx) => {
    const [conversation] = await tx.select({ id: conversations.id }).from(conversations)
      .where(eq(conversations.id, conversationId)).for('update').limit(1)
    if (!conversation) throw new Error('Conversation not found.')

    const [membership] = await tx.select({ id: conversationMembers.id }).from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId))).limit(1)
    if (!membership) throw new Error('Conversation not found.')

    const attachments = await tx.select({ pathname: messageAttachments.pathname }).from(messageAttachments)
      .where(eq(messageAttachments.conversationId, conversationId))
    removedPathnames = attachments.map((attachment) => attachment.pathname)

    await tx.delete(messageAttachments).where(eq(messageAttachments.conversationId, conversationId))
    await tx.delete(messageReactions).where(eq(messageReactions.conversationId, conversationId))
    await tx.delete(messageReceipts).where(eq(messageReceipts.conversationId, conversationId))
    await tx.delete(notifications).where(and(eq(notifications.conversationId, conversationId), isNotNull(notifications.messageId)))
    await tx.delete(messages).where(eq(messages.conversationId, conversationId))
    await tx.delete(conversationTyping).where(eq(conversationTyping.conversationId, conversationId))
    await tx.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId))
  })

  if (removedPathnames.length) await del(removedPathnames).catch(() => undefined)
}

export async function deleteConversationAction(conversationIdInput: string) {
  const userId = await requireUserId()
  const conversationId = conversationIdInput.trim()
  if (!conversationId || conversationId.length > 80) throw new Error('Conversation not found.')

  let removedPathnames: string[] = []
  await db.transaction(async (tx) => {
    const [conversation] = await tx.select({ id: conversations.id, isGroup: conversations.isGroup }).from(conversations)
      .where(eq(conversations.id, conversationId)).for('update').limit(1)
    if (!conversation || conversation.isGroup) throw new Error('Conversation not found.')

    const [membership] = await tx.select({ id: conversationMembers.id }).from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId))).limit(1)
    if (!membership) throw new Error('Conversation not found.')

    const otherMembers = await tx.select({ userId: conversationMembers.userId }).from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversationId), ne(conversationMembers.userId, userId)))

    await tx.delete(notifications).where(and(eq(notifications.userId, userId), eq(notifications.conversationId, conversationId)))
    await tx.delete(conversationMembers).where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)))

    if (!otherMembers.length) {
      const attachments = await tx.select({ pathname: messageAttachments.pathname }).from(messageAttachments)
        .where(eq(messageAttachments.conversationId, conversationId))
      removedPathnames = attachments.map((attachment) => attachment.pathname)

      await tx.delete(messageAttachments).where(eq(messageAttachments.conversationId, conversationId))
      await tx.delete(messageReactions).where(eq(messageReactions.conversationId, conversationId))
      await tx.delete(messageReceipts).where(eq(messageReceipts.conversationId, conversationId))
      await tx.delete(notifications).where(eq(notifications.conversationId, conversationId))
      await tx.delete(messages).where(eq(messages.conversationId, conversationId))
      await tx.delete(conversationTyping).where(eq(conversationTyping.conversationId, conversationId))
      await tx.delete(conversations).where(eq(conversations.id, conversationId))
    }
  })

  if (removedPathnames.length) await del(removedPathnames).catch(() => undefined)
}

export async function toggleMessagePinAction(messageIdInput: string) {
  const userId = await requireUserId()
  const messageId = typeof messageIdInput === 'string' ? messageIdInput.trim() : ''
  if (!messageId || messageId.length > 80) throw new Error('Message not found.')

  return db.transaction(async (tx) => {
    const [candidate] = await tx.select({ conversationId: messages.conversationId })
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1)
    if (!candidate) throw new Error('Message not found.')

    const [conversation] = await tx.select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, candidate.conversationId))
      .for('update')
      .limit(1)
    if (!conversation) throw new Error('Message not found.')

    const [membership] = await tx.select({ id: conversationMembers.id })
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, candidate.conversationId), eq(conversationMembers.userId, userId)))
      .limit(1)
    if (!membership) throw new Error('Message not found.')

    const [message] = await tx.select({ id: messages.id, conversationId: messages.conversationId, pinnedAt: messages.pinnedAt })
      .from(messages)
      .where(and(
        eq(messages.id, messageId),
        eq(messages.conversationId, candidate.conversationId),
        isNull(messages.deletedAt),
        or(isNull(messages.expiresAt), gt(messages.expiresAt, new Date())),
      ))
      .limit(1)
    if (!message) throw new Error('Message is no longer available.')

    if (message.pinnedAt) {
      await tx.update(messages).set({ pinnedAt: null }).where(eq(messages.id, message.id))
      return false
    }

    const pinnedMessages = await tx.select({ id: messages.id })
      .from(messages)
      .where(and(
        eq(messages.conversationId, message.conversationId),
        isNotNull(messages.pinnedAt),
        isNull(messages.deletedAt),
        or(isNull(messages.expiresAt), gt(messages.expiresAt, new Date())),
      ))
    if (pinnedMessages.length >= 3) throw new Error('You can pin up to 3 messages in a conversation.')

    await tx.update(messages).set({ pinnedAt: new Date() }).where(eq(messages.id, message.id))
    return true
  })
}

export async function createStatusAction(captionInput: string) {
  const userId = await requireUserId()
  const caption = captionInput.trim()
  if (!caption || caption.length > 280) throw new Error('Status updates must be between 1 and 280 characters.')

  await db.insert(statuses).values({
    id: randomUUID(),
    userId,
    caption,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  })
}

export async function createMediaStatusAction(captionInput: string, pathnameInput: string, filenameInput: string) {
  const userId = await requireUserId()
  if (typeof captionInput !== 'string' || typeof pathnameInput !== 'string' || typeof filenameInput !== 'string') {
    throw new Error('The selected status media could not be verified.')
  }
  const caption = captionInput.trim()
  const pathname = pathnameInput.trim()
  if (caption.length > 280) throw new Error('Status captions can be up to 280 characters.')
  if (!pathname.startsWith(`users/${userId}/statuses/`) || pathname.length > 512 || pathname.split('/').length !== 4) {
    throw new Error('The selected status media could not be verified.')
  }

  const metadata = await head(pathname)
  const contentType = metadata.contentType.toLowerCase()
  if (!STATUS_MEDIA_TYPES.includes(contentType as typeof STATUS_MEDIA_TYPES[number]) || metadata.size > MAX_STATUS_FILE_BYTES) {
    await del(pathname).catch(() => undefined)
    throw new Error('Choose a supported photo or video up to 50 MB.')
  }

  await db.insert(statuses).values({
    id: randomUUID(),
    userId,
    caption,
    mediaPathname: pathname,
    mediaType: contentType,
    mediaName: safeDisplayName(filenameInput),
    mediaSize: metadata.size,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  })
}

export async function discardMediaUploadsAction(pathnamesInput: string[]) {
  const userId = await requireUserId()
  if (!Array.isArray(pathnamesInput) || pathnamesInput.length > MAX_CHAT_ATTACHMENTS) return

  const pathnames = Array.from(new Set(pathnamesInput.filter((pathname) => {
    if (typeof pathname !== 'string' || pathname.length > 512) return false
    const segments = pathname.split('/')
    return segments[0] === 'users' && segments[1] === userId && (
      (segments[2] === 'statuses' && segments.length === 4) ||
      (segments[2] === 'messages' && segments.length === 5) ||
      (segments[2] === 'profile' && segments.length === 4)
    )
  })))
  if (!pathnames.length) return

  const [usedAttachments, usedStatuses, usedProfilePhotos, usedProfileBanners] = await Promise.all([
    db.select({ pathname: messageAttachments.pathname }).from(messageAttachments).where(inArray(messageAttachments.pathname, pathnames)),
    db.select({ pathname: statuses.mediaPathname }).from(statuses).where(inArray(statuses.mediaPathname, pathnames)),
    db.select({ pathname: users.image }).from(users).where(inArray(users.image, pathnames)),
    db.select({ pathname: userProfiles.bannerPathname }).from(userProfiles).where(inArray(userProfiles.bannerPathname, pathnames)),
  ])
  const used = new Set([
    ...usedAttachments.map((row) => row.pathname),
    ...usedStatuses.map((row) => row.pathname).filter((pathname): pathname is string => Boolean(pathname)),
    ...usedProfilePhotos.map((row) => row.pathname).filter((pathname): pathname is string => Boolean(pathname)),
    ...usedProfileBanners.map((row) => row.pathname).filter((pathname): pathname is string => Boolean(pathname)),
  ])
  const unused = pathnames.filter((pathname) => !used.has(pathname))
  if (unused.length) await del(unused).catch(() => undefined)
}

export async function updateProfilePhotoAction(pathnameInput: string) {
  const userId = await requireUserId()
  const pathname = pathnameInput.trim()
  if (!isProfilePhotoPathname(pathname, userId)) throw new Error('Choose a valid profile photo.')

  const metadata = await head(pathname)
  const contentType = metadata.contentType.toLowerCase()
  if (!PROFILE_PHOTO_TYPES.includes(contentType as typeof PROFILE_PHOTO_TYPES[number]) || metadata.size > MAX_PROFILE_PHOTO_BYTES) {
    await del(pathname).catch(() => undefined)
    throw new Error('Choose a JPG, PNG, WebP, or GIF image up to 5 MB.')
  }

  const [user] = await db.select({ image: users.image, bannerPathname: userProfiles.bannerPathname })
    .from(users).leftJoin(userProfiles, eq(userProfiles.userId, users.id)).where(eq(users.id, userId)).limit(1)
  if (!user) throw new Error('Account not found.')

  await db.update(users).set({ image: pathname, updatedAt: new Date() }).where(eq(users.id, userId))
  if (user.image && user.image !== pathname && user.image !== user.bannerPathname && isProfilePhotoPathname(user.image, userId)) {
    await del(user.image).catch(() => undefined)
  }
}

const avatarDecorationChoices: AvatarDecoration[] = ['minimal', 'square', 'halo', 'orbit', 'spark']

export async function updateProfileBannerAction(pathnameInput: string) {
  const userId = await requireUserId()
  const pathname = pathnameInput.trim()
  if (!isProfilePhotoPathname(pathname, userId)) throw new Error('Choose a valid profile banner.')

  const metadata = await head(pathname)
  const contentType = metadata.contentType.toLowerCase()
  if (!PROFILE_PHOTO_TYPES.includes(contentType as typeof PROFILE_PHOTO_TYPES[number]) || metadata.size > MAX_PROFILE_BANNER_BYTES) {
    await del(pathname).catch(() => undefined)
    throw new Error('Choose a JPG, PNG, WebP, or GIF image up to 8 MB.')
  }

  const [profile] = await db.select({ username: userProfiles.username, bannerPathname: userProfiles.bannerPathname })
    .from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1)
  const [account] = profile ? [] : await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1)
  const username = profile?.username ?? `${(account?.email.split('@')[0] ?? 'friend').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 18) || 'friend'}_${userId.slice(-6).toLowerCase()}`
  await db.insert(userProfiles).values({ userId, username, bannerPathname: pathname, updatedAt: new Date() }).onConflictDoUpdate({
    target: userProfiles.userId,
    set: { bannerPathname: pathname, updatedAt: new Date() },
  })

  const oldBanner = profile?.bannerPathname
  if (oldBanner && oldBanner !== pathname && isProfilePhotoPathname(oldBanner, userId)) {
    const [user] = await db.select({ image: users.image }).from(users).where(eq(users.id, userId)).limit(1)
    if (user?.image !== oldBanner) await del(oldBanner).catch(() => undefined)
  }
}

export async function updateAvatarDecorationAction(decorationInput: string) {
  const userId = await requireUserId()
  if (!avatarDecorationChoices.includes(decorationInput as AvatarDecoration)) throw new Error('Choose a valid avatar decoration.')
  const [profile] = await db.select({ userId: userProfiles.userId }).from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1)
  if (!profile) throw new Error('Profile not found.')
  await db.update(userProfiles).set({ avatarDecoration: decorationInput as AvatarDecoration, updatedAt: new Date() })
    .where(eq(userProfiles.userId, userId))
}

export async function updateProfileAction(nameInput: string, aboutInput: string, usernameInput: string) {
  const userId = await requireUserId()
  const isAdmin = await isAdminUserId(userId)
  const name = nameInput.trim().replace(/\s+/g, ' ')
  const about = aboutInput.trim()
  const username = usernameInput.trim().replace(/^@/, '').toLowerCase()
  if (name.length < 1 || name.length > 100) throw new Error('Name must be between 1 and 100 characters.')
  if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error('Usernames must be 3–24 characters and use letters, numbers, or underscores.')
  if (about.length < 1 || (!isAdmin && about.length > 120)) {
    throw new Error(isAdmin ? 'About text cannot be empty.' : 'About text must be between 1 and 120 characters.')
  }

  try {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ name, updatedAt: new Date() }).where(eq(users.id, userId))
      await tx.insert(userProfiles).values({ userId, username, about, updatedAt: new Date() }).onConflictDoUpdate({
        target: userProfiles.userId,
        set: { username, about, updatedAt: new Date() },
      })
    })
  } catch {
    throw new Error('That username is already taken. Choose another one.')
  }
}

const visibilityChoices: Visibility[] = ['everyone', 'contacts', 'nobody']
const timerChoices: MessageTimer[] = ['off', '24h', '7d', '90d']

export async function updatePreferencesAction(input: ChatPreferences) {
  const userId = await requireUserId()
  const preferences = input as ChatPreferences
  const visibilityFields: Array<keyof Pick<ChatPreferences, 'lastSeenVisibility' | 'profilePhotoVisibility' | 'aboutVisibility' | 'statusVisibility' | 'groupInvitePolicy' | 'callsPrivacy'>> = [
    'lastSeenVisibility', 'profilePhotoVisibility', 'aboutVisibility', 'statusVisibility', 'groupInvitePolicy', 'callsPrivacy',
  ]
  if (visibilityFields.some((field) => !visibilityChoices.includes(preferences[field] as Visibility))) {
    throw new Error('Choose a valid privacy option.')
  }
  if (!timerChoices.includes(preferences.defaultMessageTimer as MessageTimer)) throw new Error('Choose a valid message timer.')
  const booleanFields: Array<keyof ChatPreferences> = ['readReceipts', 'securityNotifications', 'notifyMessages', 'notifyGroupMessages', 'notifyMentions', 'notifyReactions', 'notifyInvitations', 'notifyAnnouncements', 'notificationSound']
  if (booleanFields.some((field) => typeof preferences[field] !== 'boolean')) {
    throw new Error('Choose valid account preferences.')
  }

  const [profile] = await db.select({ username: userProfiles.username }).from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1)
  const account = profile ? undefined : (await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1))[0]
  const username = profile?.username ?? `${(account?.email.split('@')[0] ?? 'friend').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 18) || 'friend'}_${userId.slice(-6).toLowerCase()}`
  const values = {
    lastSeenVisibility: preferences.lastSeenVisibility as Visibility,
    profilePhotoVisibility: preferences.profilePhotoVisibility as Visibility,
    aboutVisibility: preferences.aboutVisibility as Visibility,
    statusVisibility: preferences.statusVisibility as Visibility,
    readReceipts: preferences.readReceipts,
    defaultMessageTimer: preferences.defaultMessageTimer as MessageTimer,
    groupInvitePolicy: preferences.groupInvitePolicy as Visibility,
    callsPrivacy: preferences.callsPrivacy as Visibility,
    securityNotifications: preferences.securityNotifications,
    notifyMessages: preferences.notifyMessages,
    notifyGroupMessages: preferences.notifyGroupMessages,
    notifyMentions: preferences.notifyMentions,
    notifyReactions: preferences.notifyReactions,
    notifyInvitations: preferences.notifyInvitations,
    notifyAnnouncements: preferences.notifyAnnouncements,
    notificationSound: preferences.notificationSound,
    updatedAt: new Date(),
  }
  await db.insert(userProfiles).values({ userId, username, ...values }).onConflictDoUpdate({
    target: userProfiles.userId,
    set: values,
  })
}

const reactionChoices = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const

export async function toggleMessageReactionAction(messageIdInput: string, emojiInput: string) {
  const userId = await requireUserId()
  const messageId = messageIdInput.trim()
  if (!reactionChoices.includes(emojiInput as typeof reactionChoices[number])) throw new Error('Choose a supported reaction.')
  const [message] = await db.select({ conversationId: messages.conversationId, senderId: messages.senderId }).from(messages)
    .where(and(eq(messages.id, messageId), isNull(messages.deletedAt))).limit(1)
  if (!message) throw new Error('Message not found.')
  const [membership] = await db.select({ id: conversationMembers.id }).from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, message.conversationId), eq(conversationMembers.userId, userId))).limit(1)
  if (!membership) throw new Error('Message not found.')
  const [existing] = await db.select({ id: messageReactions.id, emoji: messageReactions.emoji }).from(messageReactions)
    .where(and(eq(messageReactions.messageId, messageId), eq(messageReactions.userId, userId))).limit(1)
  if (existing?.emoji === emojiInput) {
    await db.delete(messageReactions).where(eq(messageReactions.id, existing.id))
    return
  }
  await db.insert(messageReactions).values({ id: randomUUID(), messageId, conversationId: message.conversationId, userId, emoji: emojiInput })
    .onConflictDoUpdate({ target: [messageReactions.messageId, messageReactions.userId], set: { emoji: emojiInput, createdAt: new Date() } })
  if (message.senderId !== userId) {
    const [profile] = await db.select({ notifyReactions: userProfiles.notifyReactions }).from(userProfiles).where(eq(userProfiles.userId, message.senderId)).limit(1)
    if (profile?.notifyReactions !== false) {
      await db.insert(notifications).values({ id: randomUUID(), userId: message.senderId, type: 'reaction', actorUserId: userId, conversationId: message.conversationId, messageId, title: 'New reaction', body: `${emojiInput} reaction` })
    }
  }
}

export async function setTypingAction(conversationIdInput: string, isTyping: boolean) {
  const userId = await requireUserId()
  const conversationId = conversationIdInput.trim()
  if (!conversationId || conversationId.length > 80 || typeof isTyping !== 'boolean') return
  const [membership] = await db.select({ id: conversationMembers.id }).from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId))).limit(1)
  if (!membership) throw new Error('Conversation not found.')
  if (!isTyping) {
    await db.delete(conversationTyping).where(and(eq(conversationTyping.conversationId, conversationId), eq(conversationTyping.userId, userId)))
    return
  }
  await db.insert(conversationTyping).values({ id: randomUUID(), conversationId, userId, expiresAt: new Date(Date.now() + 8_000) })
    .onConflictDoUpdate({ target: [conversationTyping.conversationId, conversationTyping.userId], set: { expiresAt: new Date(Date.now() + 8_000) } })
}

export async function updateGroupDetailsAction(conversationIdInput: string, titleInput: string, descriptionInput: string) {
  const userId = await requireUserId()
  const conversationId = conversationIdInput.trim()
  const title = titleInput.trim()
  const description = descriptionInput.trim()
  if (title.length < 2 || title.length > 80 || description.length > 280) throw new Error('Use a group name from 2 to 80 characters and a description up to 280 characters.')
  const [membership] = await db.select({ role: conversationMembers.role }).from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId), eq(conversations.isGroup, true))).limit(1)
  if (membership?.role !== 'admin') throw new Error('Only group admins can update group details.')
  await db.update(conversations).set({ title, description: description || null, updatedAt: new Date() }).where(eq(conversations.id, conversationId))
}

export async function removeGroupMemberAction(conversationIdInput: string, targetUserIdInput: string) {
  const userId = await requireUserId()
  const conversationId = conversationIdInput.trim()
  const targetUserId = targetUserIdInput.trim()
  if (!conversationId || !targetUserId || targetUserId === userId) throw new Error('Choose another group member to remove.')
  const [membership] = await db.select({ role: conversationMembers.role }).from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId), eq(conversations.isGroup, true))).limit(1)
  if (membership?.role !== 'admin') throw new Error('Only group admins can remove members.')
  const [target] = await db.select({ role: conversationMembers.role }).from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, targetUserId))).limit(1)
  if (!target || target.role === 'admin') throw new Error('That member cannot be removed.')
  await db.delete(conversationMembers).where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, targetUserId)))
}

export async function leaveGroupAction(conversationIdInput: string) {
  const userId = await requireUserId()
  const conversationId = conversationIdInput.trim()
  const [membership] = await db.select({ role: conversationMembers.role }).from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId), eq(conversations.isGroup, true))).limit(1)
  if (!membership) throw new Error('Group not found.')
  await db.transaction(async (tx) => {
    const remainingMembers = await tx.select({ userId: conversationMembers.userId, role: conversationMembers.role })
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversationId), ne(conversationMembers.userId, userId)))
      .orderBy(asc(conversationMembers.joinedAt))
    if (!remainingMembers.length) throw new Error('You are the last member. Add another member before leaving.')
    if (membership.role === 'admin' && !remainingMembers.some((member) => member.role === 'admin')) {
      await tx.update(conversationMembers).set({ role: 'admin' }).where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, remainingMembers[0].userId)))
    }
    await tx.delete(conversationMembers).where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)))
  })
}

export async function inviteGroupMemberAction(conversationIdInput: string, emailInput: string) {
  const userId = await requireUserId()
  const conversationId = conversationIdInput.trim()
  const email = emailInput.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid email address.')
  const [membership] = await db.select({ role: conversationMembers.role }).from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId), eq(conversations.isGroup, true))).limit(1)
  if (membership?.role !== 'admin') throw new Error('Only group admins can invite members.')
  const [invitee] = await db.select({ id: users.id, name: users.name, policy: userProfiles.groupInvitePolicy }).from(users)
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id)).where(eq(users.email, email)).limit(1)
  if (!invitee || invitee.id === userId) throw new Error('We could not find that account.')
  const [alreadyMember] = await db.select({ id: conversationMembers.id }).from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, invitee.id))).limit(1)
  if (alreadyMember) throw new Error('That person is already in this group.')
  if (invitee.policy === 'nobody') throw new Error('That person does not accept group invitations.')
  if (invitee.policy === 'contacts') {
    const sharedDirect = await db.select({ conversationId: conversationMembers.conversationId }).from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(and(eq(conversationMembers.userId, userId), eq(conversations.isGroup, false)))
    if (!sharedDirect.length) throw new Error('That person only accepts invitations from contacts.')
    const [known] = await db.select({ id: conversationMembers.id }).from(conversationMembers)
      .where(and(inArray(conversationMembers.conversationId, sharedDirect.map((item) => item.conversationId)), eq(conversationMembers.userId, invitee.id))).limit(1)
    if (!known) throw new Error('That person only accepts invitations from contacts.')
  }
  await db.insert(groupInvitations).values({ id: randomUUID(), conversationId, inviterId: userId, inviteeId: invitee.id })
    .onConflictDoUpdate({ target: [groupInvitations.conversationId, groupInvitations.inviteeId], set: { inviterId: userId, status: 'pending', respondedAt: null, createdAt: new Date() } })
  const [profile] = await db.select({ notifyInvitations: userProfiles.notifyInvitations }).from(userProfiles).where(eq(userProfiles.userId, invitee.id)).limit(1)
  if (profile?.notifyInvitations !== false) await db.insert(notifications).values({ id: randomUUID(), userId: invitee.id, type: 'group_invitation', actorUserId: userId, conversationId, title: 'Group invitation', body: `You were invited to join a group.` })
}

export async function respondToGroupInvitationAction(invitationIdInput: string, accept: boolean) {
  const userId = await requireUserId()
  const invitationId = invitationIdInput.trim()
  const [invitation] = await db.select().from(groupInvitations).where(and(eq(groupInvitations.id, invitationId), eq(groupInvitations.inviteeId, userId), eq(groupInvitations.status, 'pending'))).limit(1)
  if (!invitation) throw new Error('Invitation not found or already answered.')
  await db.transaction(async (tx) => {
    if (accept) {
      await tx.insert(conversationMembers).values({ id: randomUUID(), conversationId: invitation.conversationId, userId, role: 'member' }).onConflictDoNothing()
    }
    await tx.update(groupInvitations).set({ status: accept ? 'accepted' : 'declined', respondedAt: new Date() }).where(eq(groupInvitations.id, invitationId))
    await tx.insert(notifications).values({ id: randomUUID(), userId: invitation.inviterId, type: accept ? 'invitation_accepted' : 'invitation_declined', actorUserId: userId, conversationId: invitation.conversationId, title: accept ? 'Invitation accepted' : 'Invitation declined', body: accept ? 'A member joined your group.' : 'A member declined your invitation.' })
  })
}

export async function toggleBlockedUserAction(targetUserIdInput: string) {
  const userId = await requireUserId()
  const targetUserId = targetUserIdInput.trim()
  if (!targetUserId || targetUserId === userId || targetUserId.length > 80) throw new Error('Choose a valid account to block.')
  const [existing] = await db.select({ id: blockedUsers.id }).from(blockedUsers).where(and(eq(blockedUsers.blockerId, userId), eq(blockedUsers.blockedUserId, targetUserId))).limit(1)
  if (existing) await db.delete(blockedUsers).where(eq(blockedUsers.id, existing.id))
  else await db.insert(blockedUsers).values({ id: randomUUID(), blockerId: userId, blockedUserId: targetUserId }).onConflictDoNothing()
}

export async function deleteOwnAccountAction(confirmation: string) {
  const userId = await requireUserId()
  if (confirmation !== 'DELETE') throw new Error('Type DELETE to confirm account removal.')
  const [user] = await db.select({ email: users.email, image: users.image, bannerPathname: userProfiles.bannerPathname })
    .from(users).leftJoin(userProfiles, eq(userProfiles.userId, users.id)).where(eq(users.id, userId)).limit(1)
  if (!user) throw new Error('Account not found.')

  let removedPathnames: string[] = []
  await db.transaction(async (tx) => {
    const memberships = await tx.select({ conversationId: conversationMembers.conversationId })
      .from(conversationMembers).where(eq(conversationMembers.userId, userId))
    const conversationIds = Array.from(new Set(memberships.map((membership) => membership.conversationId)))
    let privateConversationIds: string[] = []

    if (conversationIds.length) {
      const otherMembers = await tx.select({ conversationId: conversationMembers.conversationId })
        .from(conversationMembers)
        .where(and(inArray(conversationMembers.conversationId, conversationIds), ne(conversationMembers.userId, userId)))
      const sharedConversationIds = new Set(otherMembers.map((member) => member.conversationId))
      privateConversationIds = conversationIds.filter((id) => !sharedConversationIds.has(id))
    }

    const ownedAttachments = await tx.select({ pathname: messageAttachments.pathname })
      .from(messageAttachments).where(eq(messageAttachments.uploadedBy, userId))
    const privateConversationAttachments = privateConversationIds.length
      ? await tx.select({ pathname: messageAttachments.pathname }).from(messageAttachments)
        .where(inArray(messageAttachments.conversationId, privateConversationIds))
      : []
    const ownedStatuses = await tx.select({ pathname: statuses.mediaPathname })
      .from(statuses).where(eq(statuses.userId, userId))
    removedPathnames = Array.from(new Set([
      ...ownedAttachments.map((attachment) => attachment.pathname),
      ...privateConversationAttachments.map((attachment) => attachment.pathname),
      ...ownedStatuses.map((status) => status.pathname).filter((pathname): pathname is string => Boolean(pathname)),
      ...(user.image && isProfilePhotoPathname(user.image, userId) ? [user.image] : []),
      ...(user.bannerPathname && isProfilePhotoPathname(user.bannerPathname, userId) ? [user.bannerPathname] : []),
    ]))

    await tx.delete(messageAttachments).where(eq(messageAttachments.uploadedBy, userId))
    await tx.delete(statuses).where(eq(statuses.userId, userId))
    if (privateConversationIds.length) {
      await tx.delete(messageAttachments).where(inArray(messageAttachments.conversationId, privateConversationIds))
      await tx.delete(messages).where(inArray(messages.conversationId, privateConversationIds))
      await tx.delete(conversations).where(inArray(conversations.id, privateConversationIds))
    }
    await tx.delete(messages).where(eq(messages.senderId, userId))
    await tx.delete(conversationMembers).where(eq(conversationMembers.userId, userId))
    await tx.update(adminControlRecords).set({ status: 'revoked', updatedAt: new Date() }).where(and(
      eq(adminControlRecords.recordType, 'role'),
      eq(adminControlRecords.roleUserId, userId),
      eq(adminControlRecords.status, 'active'),
    ))
    await tx.delete(userProfiles).where(eq(userProfiles.userId, userId))
    await tx.delete(sessions).where(eq(sessions.userId, userId))
    await tx.delete(accounts).where(eq(accounts.userId, userId))
    await tx.delete(verifications).where(eq(verifications.identifier, user.email))
    await tx.delete(users).where(eq(users.id, userId))
  })
  if (removedPathnames.length) await del(removedPathnames).catch(() => undefined)
}
