import { and, count, desc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  conversationMembers,
  conversations,
  messages,
  statuses,
  userProfiles,
  users,
  adminControlRecords,
} from '@/lib/db/schema'
import { getSessionUser } from '@/lib/auth-session'
import { getUserAccessState } from '@/lib/admin-auth'
import { profileImageUrl } from '@/lib/media'
import type { ChatPreferences, ChatUser, ConversationPreview, Contact, StatusGroup, MessageTimer, Visibility } from '@/lib/chat-types'

function visibilityPreference(value: string | undefined, fallback: Visibility): Visibility {
  return value === 'everyone' || value === 'contacts' || value === 'nobody' ? value : fallback
}

function messageTimerPreference(value: string | undefined): MessageTimer {
  return value === '24h' || value === '7d' || value === '90d' || value === 'off' ? value : 'off'
}

export async function getWorkspaceData() {
  const sessionUser = await getSessionUser()
  if (!sessionUser) throw new Error('Unauthorized')
  const access = await getUserAccessState(sessionUser.id)

  const defaultAbout = access.isAdmin ? 'F.R.I.E.N.D.S creator' : 'Available'
  await db
    .insert(userProfiles)
    .values({ userId: sessionUser.id, about: defaultAbout })
    .onConflictDoNothing({ target: userProfiles.userId })

  const [profile] = await db
    .select({
      about: userProfiles.about,
      lastSeenVisibility: userProfiles.lastSeenVisibility,
      profilePhotoVisibility: userProfiles.profilePhotoVisibility,
      aboutVisibility: userProfiles.aboutVisibility,
      statusVisibility: userProfiles.statusVisibility,
      readReceipts: userProfiles.readReceipts,
      defaultMessageTimer: userProfiles.defaultMessageTimer,
      groupInvitePolicy: userProfiles.groupInvitePolicy,
      callsPrivacy: userProfiles.callsPrivacy,
      securityNotifications: userProfiles.securityNotifications,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, sessionUser.id))
    .limit(1)

  const user: ChatUser = {
    id: sessionUser.id,
    name: sessionUser.name,
    email: sessionUser.email,
    emailVerified: Boolean(sessionUser.emailVerified),
    image: profileImageUrl(sessionUser.image ?? null, sessionUser.id),
    about: profile?.about ?? defaultAbout,
    isAdmin: access.isAdmin,
  }

  const preferences: ChatPreferences = {
    lastSeenVisibility: visibilityPreference(profile?.lastSeenVisibility, 'everyone'),
    profilePhotoVisibility: visibilityPreference(profile?.profilePhotoVisibility, 'everyone'),
    aboutVisibility: visibilityPreference(profile?.aboutVisibility, 'contacts'),
    statusVisibility: visibilityPreference(profile?.statusVisibility, 'contacts'),
    readReceipts: profile?.readReceipts ?? true,
    defaultMessageTimer: messageTimerPreference(profile?.defaultMessageTimer),
    groupInvitePolicy: visibilityPreference(profile?.groupInvitePolicy, 'everyone'),
    callsPrivacy: visibilityPreference(profile?.callsPrivacy, 'everyone'),
    securityNotifications: profile?.securityNotifications ?? true,
  }

  const memberships = await db
    .select({
      conversationId: conversationMembers.conversationId,
      lastReadAt: conversationMembers.lastReadAt,
      title: conversations.title,
      isGroup: conversations.isGroup,
      updatedAt: conversations.updatedAt,
    })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(eq(conversationMembers.userId, sessionUser.id))
    .orderBy(desc(conversations.updatedAt))
    .limit(80)

  const conversationIds = memberships.map((membership) => membership.conversationId)
  const contactsById = new Map<string, Contact>()
  const conversationsList: ConversationPreview[] = []
  const peopleByConversation = new Map<string, Array<{ id: string; name: string; email: string; image: string | null; about: string | null }>>()

  if (conversationIds.length) {
    const participantRows = await db
      .select({
        conversationId: conversationMembers.conversationId,
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        about: userProfiles.about,
        profilePhotoVisibility: userProfiles.profilePhotoVisibility,
        aboutVisibility: userProfiles.aboutVisibility,
      })
      .from(conversationMembers)
      .innerJoin(users, eq(users.id, conversationMembers.userId))
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(inArray(conversationMembers.conversationId, conversationIds))

    for (const person of participantRows) {
      const people = peopleByConversation.get(person.conversationId) ?? []
      people.push({ ...person, image: profileImageUrl(person.image, person.id) })
      peopleByConversation.set(person.conversationId, people)
      if (person.id !== sessionUser.id) {
        contactsById.set(person.id, {
          id: person.id,
          name: person.name,
          email: person.email,
          image: person.profilePhotoVisibility === 'nobody' ? null : profileImageUrl(person.image, person.id),
          about: person.aboutVisibility === 'nobody' ? '' : person.about ?? 'Available',
        })
      }
    }
  }

  const rankedMessages = db
    .select({
      conversationId: messages.conversationId,
      body: messages.body,
      createdAt: messages.createdAt,
      rank: sql<number>`row_number() over (partition by ${messages.conversationId} order by ${messages.createdAt} desc)`.as('rank'),
    })
    .from(messages)
    .where(conversationIds.length ? and(
      inArray(messages.conversationId, conversationIds),
      isNull(messages.deletedAt),
      or(isNull(messages.expiresAt), gt(messages.expiresAt, new Date())),
    ) : sql`false`)
    .as('ranked_messages')

  const latestMessages = conversationIds.length
    ? await db.select().from(rankedMessages).where(eq(rankedMessages.rank, 1))
    : []
  const latestMessageByConversation = new Map(latestMessages.map((message) => [message.conversationId, message]))

  const unreadRows = conversationIds.length
    ? await db
        .select({ conversationId: conversationMembers.conversationId, value: count(messages.id) })
        .from(conversationMembers)
        .leftJoin(
          messages,
          and(
            eq(messages.conversationId, conversationMembers.conversationId),
            ne(messages.senderId, sessionUser.id),
            gt(messages.createdAt, sql<Date>`coalesce(${conversationMembers.lastReadAt}, '1970-01-01'::timestamp)`),
            isNull(messages.deletedAt),
            or(isNull(messages.expiresAt), gt(messages.expiresAt, new Date())),
          ),
        )
        .where(and(eq(conversationMembers.userId, sessionUser.id), inArray(conversationMembers.conversationId, conversationIds)))
        .groupBy(conversationMembers.conversationId)
    : []
  const unreadByConversation = new Map(unreadRows.map((row) => [row.conversationId, row.value]))

  for (const membership of memberships) {
    const otherPeople = (peopleByConversation.get(membership.conversationId) ?? []).filter((person) => person.id !== sessionUser.id)
    const lastMessage = latestMessageByConversation.get(membership.conversationId)
    const fallbackName = otherPeople.map((person) => person.name).join(', ') || 'Conversation'
    conversationsList.push({
      id: membership.conversationId,
      name: membership.title || fallbackName,
      image: membership.isGroup ? null : otherPeople[0]?.image ?? null,
      isGroup: membership.isGroup,
      lastMessage: lastMessage?.body ?? null,
      lastMessageAt: (lastMessage?.createdAt ?? membership.updatedAt).toISOString(),
      unreadCount: unreadByConversation.get(membership.conversationId) ?? 0,
      participantCount: (peopleByConversation.get(membership.conversationId) ?? []).length,
    })
  }

  const visibleUserIds = [sessionUser.id, ...contactsById.keys()]
  const statusRows = await db
    .select({
      id: statuses.id,
      caption: statuses.caption,
      createdAt: statuses.createdAt,
      expiresAt: statuses.expiresAt,
      mediaPathname: statuses.mediaPathname,
      mediaType: statuses.mediaType,
      mediaName: statuses.mediaName,
      mediaSize: statuses.mediaSize,
      userId: users.id,
      name: users.name,
      image: users.image,
      profilePhotoVisibility: userProfiles.profilePhotoVisibility,
    })
    .from(statuses)
    .innerJoin(users, eq(users.id, statuses.userId))
    .leftJoin(userProfiles, eq(userProfiles.userId, statuses.userId))
    .where(and(
      inArray(statuses.userId, visibleUserIds),
      gt(statuses.expiresAt, new Date()),
      or(eq(statuses.userId, sessionUser.id), isNull(userProfiles.userId), ne(userProfiles.statusVisibility, 'nobody')),
    ))
    .orderBy(desc(statuses.createdAt))
    .limit(120)

  const statusMap = new Map<string, StatusGroup>()
  for (const row of statusRows) {
    const group = statusMap.get(row.userId) ?? {
      userId: row.userId,
      name: row.userId === sessionUser.id ? 'You' : row.name,
      image: row.userId !== sessionUser.id && row.profilePhotoVisibility === 'nobody' ? null : profileImageUrl(row.image, row.userId),
      isMe: row.userId === sessionUser.id,
      items: [],
    }
    group.items.push({
      id: row.id,
      caption: row.caption,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      mediaUrl: row.mediaPathname ? `/api/media?pathname=${encodeURIComponent(row.mediaPathname)}` : null,
      mediaType: row.mediaType,
      mediaName: row.mediaName,
      mediaSize: row.mediaSize,
    })
    statusMap.set(row.userId, group)
  }

  const statusesList = Array.from(statusMap.values()).sort((a, b) =>
    a.isMe === b.isMe ? a.name.localeCompare(b.name) : a.isMe ? -1 : 1,
  )

  const [announcementRecord] = await db.select({ id: adminControlRecords.id, payload: adminControlRecords.payload, createdAt: adminControlRecords.createdAt })
    .from(adminControlRecords)
    .where(and(eq(adminControlRecords.recordType, 'announcement'), eq(adminControlRecords.status, 'active')))
    .orderBy(desc(adminControlRecords.createdAt))
    .limit(1)
  const announcementTitle = announcementRecord?.payload.title
  const announcementBody = announcementRecord?.payload.body
  const announcement = announcementRecord && typeof announcementTitle === 'string' && typeof announcementBody === 'string'
    ? { id: announcementRecord.id, title: announcementTitle, body: announcementBody, createdAt: announcementRecord.createdAt.toISOString() }
    : null

  return {
    user,
    preferences,
    conversations: conversationsList,
    contacts: Array.from(contactsById.values()).sort((a, b) => a.name.localeCompare(b.name)),
    statuses: statusesList,
    announcement,
  }
}
