'use server'

import { del, head } from '@vercel/blob'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  accounts,
  conversationMembers,
  conversations,
  messages,
  messageAttachments,
  sessions,
  statuses,
  userProfiles,
  users,
  verifications,
} from '@/lib/db/schema'
import { getSessionUser } from '@/lib/auth-session'
import type { ChatPreferences, MessageTimer, Visibility } from '@/lib/chat-types'
import { isProfilePhotoPathname, MAX_CHAT_ATTACHMENTS, MAX_CHAT_FILE_BYTES, MAX_PROFILE_PHOTO_BYTES, MAX_STATUS_FILE_BYTES, PROFILE_PHOTO_TYPES, STATUS_MEDIA_TYPES, safeDisplayName } from '@/lib/media'

async function requireUserId() {
  const user = await getSessionUser()
  if (!user) throw new Error('Unauthorized')
  return user.id
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
      { id: randomUUID(), conversationId, userId },
      ...recipients.map((recipient) => ({ id: randomUUID(), conversationId, userId: recipient.id })),
    ])
  })

  return conversationId
}

export async function sendMessageAction(conversationId: string, bodyInput: string) {
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
      expiresAt: duration ? new Date(now.getTime() + duration) : null,
    })
    await tx.update(conversations).set({ updatedAt: now }).where(eq(conversations.id, conversation))
  })
}

type UploadedAttachmentInput = {
  pathname: string
  filename: string
}

export async function sendMessageWithAttachmentsAction(
  conversationIdInput: string,
  bodyInput: string,
  filesInput: UploadedAttachmentInput[],
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

  const [usedAttachments, usedStatuses, usedProfilePhotos] = await Promise.all([
    db.select({ pathname: messageAttachments.pathname }).from(messageAttachments).where(inArray(messageAttachments.pathname, pathnames)),
    db.select({ pathname: statuses.mediaPathname }).from(statuses).where(inArray(statuses.mediaPathname, pathnames)),
    db.select({ pathname: users.image }).from(users).where(inArray(users.image, pathnames)),
  ])
  const used = new Set([
    ...usedAttachments.map((row) => row.pathname),
    ...usedStatuses.map((row) => row.pathname).filter((pathname): pathname is string => Boolean(pathname)),
    ...usedProfilePhotos.map((row) => row.pathname).filter((pathname): pathname is string => Boolean(pathname)),
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

  const [user] = await db.select({ image: users.image }).from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw new Error('Account not found.')

  await db.update(users).set({ image: pathname, updatedAt: new Date() }).where(eq(users.id, userId))
  if (user.image && user.image !== pathname && isProfilePhotoPathname(user.image, userId)) {
    await del(user.image).catch(() => undefined)
  }
}

export async function updateProfileAction(nameInput: string, aboutInput: string) {
  const userId = await requireUserId()
  const name = nameInput.trim().replace(/\s+/g, ' ')
  const about = aboutInput.trim()
  if (name.length < 1 || name.length > 100) throw new Error('Name must be between 1 and 100 characters.')
  if (about.length < 1 || about.length > 120) throw new Error('About text must be between 1 and 120 characters.')

  await db.transaction(async (tx) => {
    await tx.update(users).set({ name, updatedAt: new Date() }).where(eq(users.id, userId))
    await tx.insert(userProfiles).values({ userId, about, updatedAt: new Date() }).onConflictDoUpdate({
      target: userProfiles.userId,
      set: { about, updatedAt: new Date() },
    })
  })
}

const visibilityChoices: Visibility[] = ['everyone', 'contacts', 'nobody']
const timerChoices: MessageTimer[] = ['off', '24h', '7d', '90d']

export async function updatePreferencesAction(input: ChatPreferences) {
  const userId = await requireUserId()
  const preferences = input as Record<keyof ChatPreferences, unknown>
  const visibilityFields: Array<keyof Pick<ChatPreferences, 'lastSeenVisibility' | 'profilePhotoVisibility' | 'aboutVisibility' | 'statusVisibility' | 'groupInvitePolicy' | 'callsPrivacy'>> = [
    'lastSeenVisibility', 'profilePhotoVisibility', 'aboutVisibility', 'statusVisibility', 'groupInvitePolicy', 'callsPrivacy',
  ]
  if (visibilityFields.some((field) => !visibilityChoices.includes(preferences[field] as Visibility))) {
    throw new Error('Choose a valid privacy option.')
  }
  if (!timerChoices.includes(preferences.defaultMessageTimer as MessageTimer)) throw new Error('Choose a valid message timer.')
  if (typeof preferences.readReceipts !== 'boolean' || typeof preferences.securityNotifications !== 'boolean') {
    throw new Error('Choose valid account preferences.')
  }

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
    updatedAt: new Date(),
  }
  await db.insert(userProfiles).values({ userId, ...values }).onConflictDoUpdate({
    target: userProfiles.userId,
    set: values,
  })
}

export async function deleteOwnAccountAction(confirmation: string) {
  const userId = await requireUserId()
  if (confirmation !== 'DELETE') throw new Error('Type DELETE to confirm account removal.')
  const [user] = await db.select({ email: users.email, image: users.image }).from(users).where(eq(users.id, userId)).limit(1)
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
    await tx.delete(userProfiles).where(eq(userProfiles.userId, userId))
    await tx.delete(sessions).where(eq(sessions.userId, userId))
    await tx.delete(accounts).where(eq(accounts.userId, userId))
    await tx.delete(verifications).where(eq(verifications.identifier, user.email))
    await tx.delete(users).where(eq(users.id, userId))
  })
  if (removedPathnames.length) await del(removedPathnames).catch(() => undefined)
}
