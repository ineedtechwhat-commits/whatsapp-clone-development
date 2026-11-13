import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { conversationMembers, conversations, messages, statuses, userProfiles, users } from '@/lib/db/schema'
import { getSessionUser } from '@/lib/auth-session'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const memberships = await db
    .select({ conversationId: conversationMembers.conversationId })
    .from(conversationMembers)
    .where(eq(conversationMembers.userId, user.id))
  const conversationIds = Array.from(new Set(memberships.map((membership) => membership.conversationId)))

  const [profileRows, statusRows, conversationRows, messageRows] = await Promise.all([
    db.select({
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
    }).from(userProfiles).where(eq(userProfiles.userId, user.id)).limit(1),
    db.select({ caption: statuses.caption, createdAt: statuses.createdAt, expiresAt: statuses.expiresAt })
      .from(statuses).where(eq(statuses.userId, user.id)).orderBy(statuses.createdAt),
    conversationIds.length
      ? db.select({ id: conversations.id, title: conversations.title, isGroup: conversations.isGroup, createdAt: conversations.createdAt, updatedAt: conversations.updatedAt })
          .from(conversations).where(inArray(conversations.id, conversationIds)).orderBy(conversations.createdAt)
      : Promise.resolve([]),
    conversationIds.length
      ? db.select({ conversationId: messages.conversationId, senderId: messages.senderId, body: messages.body, createdAt: messages.createdAt, editedAt: messages.editedAt })
          .from(messages)
          .where(and(
            inArray(messages.conversationId, conversationIds),
            isNull(messages.deletedAt),
            or(isNull(messages.expiresAt), gt(messages.expiresAt, new Date())),
          ))
          .orderBy(messages.createdAt)
          .limit(10000)
      : Promise.resolve([]),
  ])

  return NextResponse.json({
    exportedAt: new Date().toISOString(),
    profile: { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified, image: user.image, settings: profileRows[0] ?? null },
    conversations: conversationRows,
    messages: messageRows,
    statuses: statusRows,
  }, {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'attachment; filename="friends-account-info.json"',
    },
  })
}
