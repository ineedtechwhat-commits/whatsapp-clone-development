import 'server-only'

import { del } from '@vercel/blob'
import { and, count, desc, eq, gt, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import {
  adminControlRecords,
  conversationMembers,
  conversations,
  messageAttachments,
  messages,
  sessions,
  statuses,
  userProfiles,
  users,
} from '@/lib/db/schema'
import { isAdminUserId, requireAdminUser } from '@/lib/admin-auth'
import { adminTools, type AdminToolId, type AdminToolInput, type AdminToolResult } from '@/lib/admin-tools'

function normalizedRecords<T extends object>(rows: T[]) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (value instanceof Date) return [key, value.toISOString()]
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return [key, value]
    return [key, JSON.stringify(value)]
  }))) as Array<Record<string, string | number | boolean | null>>
}

function recordsResult<T extends object>(summary: string, rows: T[]): AdminToolResult {
  return { summary, records: normalizedRecords(rows) }
}

function metricResult(label: string, value: number): AdminToolResult {
  return { summary: `${label}: ${value.toLocaleString()}`, records: [{ metric: label, value }] }
}

function cleanInput(value: string | undefined, maximum = 200) {
  return (value ?? '').trim().slice(0, maximum)
}

async function findUser(query: string) {
  const cleaned = cleanInput(query, 254)
  if (!cleaned) throw new Error('Enter an account email or user ID.')
  const pattern = `%${cleaned.replace(/[\\%_]/g, '\\$&')}%`
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(or(eq(users.id, cleaned), ilike(users.email, cleaned), ilike(users.name, pattern)))
    .limit(1)
  if (!user) throw new Error('No matching account was found.')
  return user
}

async function logAdminAction(actorId: string, action: string, subjectId: string | null, payload: Record<string, unknown> = {}) {
  await db.insert(adminControlRecords).values({
    id: randomUUID(),
    recordType: 'audit',
    actorUserId: actorId,
    subjectUserId: subjectId,
    action,
    status: 'complete',
    payload,
    updatedAt: new Date(),
  })
}

export async function getAdminOverview() {
  await requireAdminUser()
  const [userCount] = await db.select({ value: count() }).from(users)
  const [conversationCount] = await db.select({ value: count() }).from(conversations)
  const [messageCount] = await db.select({ value: count() }).from(messages).where(isNull(messages.deletedAt))
  const [openReportCount] = await db.select({ value: count() }).from(adminControlRecords).where(and(
    eq(adminControlRecords.recordType, 'report'),
    eq(adminControlRecords.status, 'open'),
  ))
  const [activeAdminCount] = await db.select({ value: count() }).from(adminControlRecords).where(and(
    eq(adminControlRecords.recordType, 'role'),
    eq(adminControlRecords.action, 'admin'),
    eq(adminControlRecords.status, 'active'),
  ))

  return {
    users: Number(userCount?.value ?? 0),
    conversations: Number(conversationCount?.value ?? 0),
    messages: Number(messageCount?.value ?? 0),
    openReports: Number(openReportCount?.value ?? 0),
    admins: Number(activeAdminCount?.value ?? 0),
  }
}

export async function runAdminTool(toolId: AdminToolId, input: AdminToolInput = {}): Promise<AdminToolResult> {
  const actor = await requireAdminUser()
  const query = cleanInput(input.query, 254)
  const targetId = cleanInput(input.targetId, 254)
  const relatedId = cleanInput(input.relatedId, 254)
  const now = new Date()
  const ago = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000)
  const requireTarget = () => {
    if (!targetId) throw new Error('Enter the required account, message, group, or record ID.')
    return targetId
  }

  switch (toolId) {
    case 'users.total': {
      const [row] = await db.select({ value: count() }).from(users)
      return metricResult('Registered users', Number(row?.value ?? 0))
    }
    case 'users.verified': {
      const [row] = await db.select({ value: count() }).from(users).where(eq(users.emailVerified, true))
      return metricResult('Verified accounts', Number(row?.value ?? 0))
    }
    case 'users.unverified': {
      const [row] = await db.select({ value: count() }).from(users).where(eq(users.emailVerified, false))
      return metricResult('Unverified accounts', Number(row?.value ?? 0))
    }
    case 'users.new24h':
    case 'users.new7d':
    case 'users.new30d': {
      const hours = toolId === 'users.new24h' ? 24 : toolId === 'users.new7d' ? 168 : 720
      const [row] = await db.select({ value: count() }).from(users).where(gt(users.createdAt, ago(hours)))
      return metricResult(`New users · ${hours === 24 ? '24 hours' : hours === 168 ? '7 days' : '30 days'}`, Number(row?.value ?? 0))
    }
    case 'conversations.total': {
      const [row] = await db.select({ value: count() }).from(conversations)
      return metricResult('Total conversations', Number(row?.value ?? 0))
    }
    case 'conversations.direct': {
      const [row] = await db.select({ value: count() }).from(conversations).where(eq(conversations.isGroup, false))
      return metricResult('Direct conversations', Number(row?.value ?? 0))
    }
    case 'conversations.groups': {
      const [row] = await db.select({ value: count() }).from(conversations).where(eq(conversations.isGroup, true))
      return metricResult('Group conversations', Number(row?.value ?? 0))
    }
    case 'messages.24h': {
      const [row] = await db.select({ value: count() }).from(messages).where(and(gt(messages.createdAt, ago(24)), isNull(messages.deletedAt)))
      return metricResult('Messages · 24 hours', Number(row?.value ?? 0))
    }
    case 'users.search': {
      if (!query) return recordsResult('Enter a name, email, or user ID to search accounts.', [])
      const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`
      const rows = await db.select({ id: users.id, name: users.name, email: users.email, emailVerified: users.emailVerified, createdAt: users.createdAt })
        .from(users).where(or(ilike(users.name, pattern), ilike(users.email, pattern), eq(users.id, query))).orderBy(desc(users.createdAt)).limit(50)
      return recordsResult(`${rows.length} matching account${rows.length === 1 ? '' : 's'}.`, rows)
    }
    case 'users.recent': {
      const rows = await db.select({ id: users.id, name: users.name, email: users.email, emailVerified: users.emailVerified, createdAt: users.createdAt })
        .from(users).orderBy(desc(users.createdAt)).limit(50)
      return recordsResult(`${rows.length} most recent accounts.`, rows)
    }
    case 'users.unverified.list': {
      const rows = await db.select({ id: users.id, name: users.name, email: users.email, createdAt: users.createdAt })
        .from(users).where(eq(users.emailVerified, false)).orderBy(desc(users.createdAt)).limit(100)
      return recordsResult(`${rows.length} unverified accounts.`, rows)
    }
    case 'users.missing-photo': {
      const rows = await db.select({ id: users.id, name: users.name, email: users.email, createdAt: users.createdAt })
        .from(users).where(isNull(users.image)).orderBy(desc(users.createdAt)).limit(100)
      return recordsResult(`${rows.length} accounts without a profile photo.`, rows)
    }
    case 'users.missing-about': {
      const rows = await db.select({ id: users.id, name: users.name, email: users.email, about: userProfiles.about })
        .from(users).leftJoin(userProfiles, eq(userProfiles.userId, users.id))
        .where(or(isNull(userProfiles.userId), eq(userProfiles.about, ''), eq(userProfiles.about, 'Available')))
        .orderBy(desc(users.createdAt)).limit(100)
      return recordsResult(`${rows.length} profiles with an empty or default bio.`, rows)
    }
    case 'users.most-conversations': {
      const rows = await db.select({ id: users.id, name: users.name, email: users.email, conversations: count(conversationMembers.id) })
        .from(users).leftJoin(conversationMembers, eq(conversationMembers.userId, users.id))
        .groupBy(users.id).orderBy(desc(count(conversationMembers.id))).limit(50)
      return recordsResult('Users ranked by conversation membership.', rows)
    }
    case 'users.profile': {
      const user = await findUser(query)
      const [row] = await db.select({ id: users.id, name: users.name, email: users.email, emailVerified: users.emailVerified, image: users.image, createdAt: users.createdAt, about: userProfiles.about })
        .from(users).leftJoin(userProfiles, eq(userProfiles.userId, users.id)).where(eq(users.id, user.id)).limit(1)
      return recordsResult('Account profile details.', row ? [row] : [])
    }
    case 'users.privacy': {
      const user = await findUser(query)
      const [row] = await db.select({ userId: userProfiles.userId, lastSeenVisibility: userProfiles.lastSeenVisibility, profilePhotoVisibility: userProfiles.profilePhotoVisibility, aboutVisibility: userProfiles.aboutVisibility, statusVisibility: userProfiles.statusVisibility, readReceipts: userProfiles.readReceipts, groupInvitePolicy: userProfiles.groupInvitePolicy })
        .from(userProfiles).where(eq(userProfiles.userId, user.id)).limit(1)
      return recordsResult(row ? 'Saved privacy preferences.' : 'No saved privacy preferences for this account.', row ? [row] : [])
    }
    case 'users.sessions': {
      const user = await findUser(query)
      const rows = await db.select({ id: sessions.id, createdAt: sessions.createdAt, expiresAt: sessions.expiresAt, ipAddress: sessions.ipAddress, userAgent: sessions.userAgent })
        .from(sessions).where(and(eq(sessions.userId, user.id), gt(sessions.expiresAt, now))).orderBy(desc(sessions.createdAt)).limit(100)
      return recordsResult(`${rows.length} active sessions. Session tokens are never displayed.`, rows)
    }
    case 'users.revoke-sessions': {
      const user = await findUser(requireTarget())
      if (await isAdminUserId(user.id)) throw new Error('Administrator sessions cannot be revoked from this tool.')
      const [row] = await db.select({ value: count() }).from(sessions).where(eq(sessions.userId, user.id))
      await db.delete(sessions).where(eq(sessions.userId, user.id))
      await logAdminAction(actor.id, 'user.sessions.revoke', user.id, { sessionCount: Number(row?.value ?? 0) })
      return { summary: `Revoked ${Number(row?.value ?? 0)} session(s) for ${user.email}.` }
    }
    case 'reports.open': {
      const rows = await db.select({ id: adminControlRecords.id, action: adminControlRecords.action, reporterId: adminControlRecords.actorUserId, subjectId: adminControlRecords.subjectUserId, status: adminControlRecords.status, payload: adminControlRecords.payload, createdAt: adminControlRecords.createdAt })
        .from(adminControlRecords).where(and(eq(adminControlRecords.recordType, 'report'), eq(adminControlRecords.status, 'open')))
        .orderBy(desc(adminControlRecords.createdAt)).limit(100)
      return recordsResult(`${rows.length} open report${rows.length === 1 ? '' : 's'}.`, rows)
    }
    case 'reports.messages': {
      const rows = await db.select({ reportId: adminControlRecords.id, messageId: adminControlRecords.subjectUserId, reporterId: adminControlRecords.actorUserId, reason: sql<string>`${adminControlRecords.payload} ->> 'reason'`, message: messages.body, senderId: messages.senderId, reportedAt: adminControlRecords.createdAt })
        .from(adminControlRecords).leftJoin(messages, eq(messages.id, adminControlRecords.subjectUserId))
        .where(and(eq(adminControlRecords.recordType, 'report'), eq(adminControlRecords.action, 'message.report'), eq(adminControlRecords.status, 'open')))
        .orderBy(desc(adminControlRecords.createdAt)).limit(100)
      return recordsResult(`${rows.length} reported message${rows.length === 1 ? '' : 's'}.`, rows)
    }
    case 'reports.users': {
      const rows = await db.select({ reportId: adminControlRecords.id, userId: adminControlRecords.subjectUserId, name: users.name, email: users.email, reporterId: adminControlRecords.actorUserId, reason: sql<string>`${adminControlRecords.payload} ->> 'reason'`, reportedAt: adminControlRecords.createdAt })
        .from(adminControlRecords).leftJoin(users, eq(users.id, adminControlRecords.subjectUserId))
        .where(and(eq(adminControlRecords.recordType, 'report'), eq(adminControlRecords.action, 'user.report'), eq(adminControlRecords.status, 'open')))
        .orderBy(desc(adminControlRecords.createdAt)).limit(100)
      return recordsResult(`${rows.length} reported account${rows.length === 1 ? '' : 's'}.`, rows)
    }
    case 'reports.resolved': {
      const rows = await db.select({ id: adminControlRecords.id, action: adminControlRecords.action, subjectId: adminControlRecords.subjectUserId, status: adminControlRecords.status, actorId: adminControlRecords.actorUserId, createdAt: adminControlRecords.createdAt })
        .from(adminControlRecords).where(and(eq(adminControlRecords.recordType, 'report'), inArray(adminControlRecords.status, ['resolved', 'dismissed'])))
        .orderBy(desc(adminControlRecords.updatedAt)).limit(100)
      return recordsResult(`${rows.length} recently resolved or dismissed reports.`, rows)
    }
    case 'messages.expired': {
      const rows = await db.select({ id: messages.id, conversationId: messages.conversationId, senderId: messages.senderId, createdAt: messages.createdAt, expiresAt: messages.expiresAt })
        .from(messages).where(and(lt(messages.expiresAt, now), isNull(messages.deletedAt))).orderBy(desc(messages.expiresAt)).limit(100)
      return recordsResult(`${rows.length} expired messages still in storage.`, rows)
    }
    case 'messages.remove': {
      const messageId = requireTarget()
      const [openReport] = await db.select({ id: adminControlRecords.id }).from(adminControlRecords)
        .where(and(eq(adminControlRecords.recordType, 'report'), eq(adminControlRecords.action, 'message.report'), eq(adminControlRecords.subjectUserId, messageId), eq(adminControlRecords.status, 'open'))).limit(1)
      if (!openReport) throw new Error('Only a message with an open report can be removed from this tool.')
      const [message] = await db.select({ id: messages.id }).from(messages).where(eq(messages.id, messageId)).limit(1)
      if (!message) throw new Error('Message not found.')
      await db.transaction(async (tx) => {
        await tx.update(messages).set({ deletedAt: now }).where(eq(messages.id, messageId))
        await tx.update(adminControlRecords).set({ status: 'resolved', updatedAt: now }).where(and(eq(adminControlRecords.recordType, 'report'), eq(adminControlRecords.action, 'message.report'), eq(adminControlRecords.subjectUserId, messageId), eq(adminControlRecords.status, 'open')))
        await tx.insert(adminControlRecords).values({ id: randomUUID(), recordType: 'audit', actorUserId: actor.id, subjectUserId: messageId, action: 'message.remove', status: 'complete', payload: { reason: cleanInput(input.reason, 500) }, updatedAt: now })
      })
      return { summary: 'Reported message removed and its open report resolved.' }
    }
    case 'messages.restore': {
      const messageId = requireTarget()
      const [removedByAdmin] = await db.select({ id: adminControlRecords.id }).from(adminControlRecords)
        .where(and(eq(adminControlRecords.recordType, 'audit'), eq(adminControlRecords.action, 'message.remove'), eq(adminControlRecords.subjectUserId, messageId))).limit(1)
      if (!removedByAdmin) throw new Error('This tool only restores messages removed by an administrator.')
      await db.update(messages).set({ deletedAt: null }).where(eq(messages.id, messageId))
      await logAdminAction(actor.id, 'message.restore', messageId)
      return { summary: 'Message restored.' }
    }
    case 'reports.dismiss': {
      const reportId = requireTarget()
      const [report] = await db.select({ id: adminControlRecords.id }).from(adminControlRecords)
        .where(and(eq(adminControlRecords.id, reportId), eq(adminControlRecords.recordType, 'report'), eq(adminControlRecords.status, 'open'))).limit(1)
      if (!report) throw new Error('Open report not found.')
      await db.update(adminControlRecords).set({ status: 'dismissed', updatedAt: now }).where(eq(adminControlRecords.id, reportId))
      await logAdminAction(actor.id, 'report.dismiss', reportId, { reason: cleanInput(input.reason, 500) })
      return { summary: 'Report dismissed and recorded in the audit log.' }
    }
    case 'users.suspend': {
      const user = await findUser(requireTarget())
      if (await isAdminUserId(user.id)) throw new Error('Administrator accounts cannot be suspended from this tool.')
      await db.insert(adminControlRecords).values({ id: randomUUID(), recordType: 'restriction', actorUserId: actor.id, subjectUserId: user.id, action: 'user.suspend', status: 'active', payload: { reason: cleanInput(input.reason, 500) }, updatedAt: now })
      await db.delete(sessions).where(eq(sessions.userId, user.id))
      await logAdminAction(actor.id, 'user.suspend', user.id, { reason: cleanInput(input.reason, 500) })
      return { summary: `Account access suspended for ${user.email}; active sessions were revoked.` }
    }
    case 'users.restore': {
      const user = await findUser(requireTarget())
      await db.insert(adminControlRecords).values({ id: randomUUID(), recordType: 'restriction', actorUserId: actor.id, subjectUserId: user.id, action: 'user.restore', status: 'restored', payload: {}, updatedAt: now })
      await logAdminAction(actor.id, 'user.restore', user.id)
      return { summary: `Account access restored for ${user.email}.` }
    }
    case 'groups.directory':
    case 'groups.largest':
    case 'groups.newest': {
      const rows = await db.select({ id: conversations.id, title: conversations.title, createdBy: conversations.createdBy, memberCount: count(conversationMembers.id), updatedAt: conversations.updatedAt })
        .from(conversations).leftJoin(conversationMembers, eq(conversationMembers.conversationId, conversations.id))
        .where(eq(conversations.isGroup, true)).groupBy(conversations.id)
        .orderBy(toolId === 'groups.largest' ? desc(count(conversationMembers.id)) : desc(conversations.updatedAt)).limit(100)
      return recordsResult(`${rows.length} group conversations.`, rows)
    }
    case 'conversations.direct.list': {
      const rows = await db.select({ id: conversations.id, createdBy: conversations.createdBy, createdAt: conversations.createdAt, updatedAt: conversations.updatedAt, memberCount: count(conversationMembers.id) })
        .from(conversations).leftJoin(conversationMembers, eq(conversationMembers.conversationId, conversations.id))
        .where(eq(conversations.isGroup, false)).groupBy(conversations.id).orderBy(desc(conversations.updatedAt)).limit(100)
      return recordsResult(`${rows.length} direct conversations. Message content is not included.`, rows)
    }
    case 'groups.empty': {
      const rows = await db.select({ id: conversations.id, title: conversations.title, createdAt: conversations.createdAt, updatedAt: conversations.updatedAt })
        .from(conversations).leftJoin(messages, eq(messages.conversationId, conversations.id))
        .where(and(eq(conversations.isGroup, true), isNull(messages.id))).orderBy(desc(conversations.createdAt)).limit(100)
      return recordsResult(`${rows.length} groups without messages.`, rows)
    }
    case 'groups.dormant': {
      const rows = await db.select({ id: conversations.id, title: conversations.title, createdBy: conversations.createdBy, updatedAt: conversations.updatedAt })
        .from(conversations).where(and(eq(conversations.isGroup, true), lt(conversations.updatedAt, ago(24 * 30)))).orderBy(conversations.updatedAt).limit(100)
      return recordsResult(`${rows.length} groups with no recent activity.`, rows)
    }
    case 'groups.members': {
      const groupId = requireTarget()
      const [group] = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, groupId), eq(conversations.isGroup, true))).limit(1)
      if (!group) throw new Error('Group conversation not found.')
      const rows = await db.select({ userId: users.id, name: users.name, email: users.email, joinedAt: conversationMembers.joinedAt })
        .from(conversationMembers).innerJoin(users, eq(users.id, conversationMembers.userId)).where(eq(conversationMembers.conversationId, groupId)).orderBy(conversationMembers.joinedAt)
      return recordsResult(`${rows.length} group members.`, rows)
    }
    case 'groups.rename': {
      const groupId = requireTarget()
      const title = cleanInput(input.title, 80)
      if (title.length < 2) throw new Error('Group name must be between 2 and 80 characters.')
      const [group] = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, groupId), eq(conversations.isGroup, true))).limit(1)
      if (!group) throw new Error('Group conversation not found.')
      await db.update(conversations).set({ title, updatedAt: now }).where(eq(conversations.id, groupId))
      await logAdminAction(actor.id, 'group.rename', groupId, { title })
      return { summary: 'Group name updated.' }
    }
    case 'groups.remove-member': {
      const groupId = requireTarget()
      if (!relatedId) throw new Error('Enter the member user ID to remove.')
      const [group] = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, groupId), eq(conversations.isGroup, true))).limit(1)
      if (!group) throw new Error('Group conversation not found.')
      const [member] = await db.select({ id: conversationMembers.id }).from(conversationMembers).where(and(eq(conversationMembers.conversationId, groupId), eq(conversationMembers.userId, relatedId))).limit(1)
      if (!member) throw new Error('That account is not a member of this group.')
      await db.delete(conversationMembers).where(eq(conversationMembers.id, member.id))
      await logAdminAction(actor.id, 'group.member.remove', relatedId, { conversationId: groupId })
      return { summary: 'Member removed from the group.' }
    }
    case 'conversations.details': {
      const conversationId = requireTarget()
      const [conversation] = await db.select({ id: conversations.id, title: conversations.title, isGroup: conversations.isGroup, createdBy: conversations.createdBy, createdAt: conversations.createdAt, updatedAt: conversations.updatedAt })
        .from(conversations).where(eq(conversations.id, conversationId)).limit(1)
      if (!conversation) throw new Error('Conversation not found.')
      const [members] = await db.select({ value: count() }).from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId))
      const [messageCount] = await db.select({ value: count() }).from(messages).where(eq(messages.conversationId, conversationId))
      return recordsResult('Conversation metadata. Message content is not included.', [{ ...conversation, members: Number(members?.value ?? 0), messages: Number(messageCount?.value ?? 0) }])
    }
    case 'statuses.active': {
      const [row] = await db.select({ value: count() }).from(statuses).where(gt(statuses.expiresAt, now))
      return metricResult('Active status updates', Number(row?.value ?? 0))
    }
    case 'statuses.expiring': {
      const soon = new Date(now.getTime() + 2 * 60 * 60 * 1000)
      const rows = await db.select({ id: statuses.id, userId: statuses.userId, mediaType: statuses.mediaType, mediaName: statuses.mediaName, createdAt: statuses.createdAt, expiresAt: statuses.expiresAt })
        .from(statuses).where(and(gt(statuses.expiresAt, now), lt(statuses.expiresAt, soon))).orderBy(statuses.expiresAt).limit(100)
      return recordsResult(`${rows.length} status updates expire within two hours.`, rows)
    }
    case 'statuses.remove': {
      const statusId = requireTarget()
      const [status] = await db.select({ id: statuses.id, mediaPathname: statuses.mediaPathname }).from(statuses).where(eq(statuses.id, statusId)).limit(1)
      if (!status) throw new Error('Status update not found.')
      if (status.mediaPathname) await del(status.mediaPathname).catch(() => undefined)
      await db.delete(statuses).where(eq(statuses.id, statusId))
      await logAdminAction(actor.id, 'status.remove', statusId)
      return { summary: 'Status update and its stored media were removed.' }
    }
    case 'attachments.list':
    case 'attachments.largest': {
      const rows = await db.select({ id: messageAttachments.id, messageId: messageAttachments.messageId, conversationId: messageAttachments.conversationId, filename: messageAttachments.filename, contentType: messageAttachments.contentType, size: messageAttachments.size, uploadedBy: messageAttachments.uploadedBy, createdAt: messageAttachments.createdAt })
        .from(messageAttachments).orderBy(toolId === 'attachments.largest' ? desc(messageAttachments.size) : desc(messageAttachments.createdAt)).limit(100)
      return recordsResult(`${rows.length} attachment records. File contents and signed URLs are not included.`, rows)
    }
    case 'attachments.remove': {
      const attachmentId = requireTarget()
      const [attachment] = await db.select({ id: messageAttachments.id, pathname: messageAttachments.pathname }).from(messageAttachments).where(eq(messageAttachments.id, attachmentId)).limit(1)
      if (!attachment) throw new Error('Attachment record not found.')
      await del(attachment.pathname).catch(() => undefined)
      await db.delete(messageAttachments).where(eq(messageAttachments.id, attachmentId))
      await logAdminAction(actor.id, 'attachment.remove', attachmentId)
      return { summary: 'Attachment metadata and stored file were removed.' }
    }
    case 'sessions.active': {
      const [row] = await db.select({ value: count() }).from(sessions).where(gt(sessions.expiresAt, now))
      return metricResult('Active sessions', Number(row?.value ?? 0))
    }
    case 'audit.recent': {
      const rows = await db.select({ id: adminControlRecords.id, actorUserId: adminControlRecords.actorUserId, subjectUserId: adminControlRecords.subjectUserId, action: adminControlRecords.action, status: adminControlRecords.status, payload: adminControlRecords.payload, createdAt: adminControlRecords.createdAt })
        .from(adminControlRecords).where(eq(adminControlRecords.recordType, 'audit')).orderBy(desc(adminControlRecords.createdAt)).limit(100)
      return recordsResult(`${rows.length} recent administrative actions.`, rows)
    }
    case 'roles.admins': {
      const rows = await db.select({ userId: adminControlRecords.roleUserId, name: users.name, email: users.email, action: adminControlRecords.action, assignedAt: adminControlRecords.createdAt })
        .from(adminControlRecords).leftJoin(users, eq(users.id, adminControlRecords.roleUserId))
        .where(and(eq(adminControlRecords.recordType, 'role'), eq(adminControlRecords.action, 'admin'), eq(adminControlRecords.status, 'active')))
        .orderBy(desc(adminControlRecords.createdAt)).limit(100)
      return recordsResult(`${rows.length} active administrator assignment${rows.length === 1 ? '' : 's'}.`, rows)
    }
    case 'announcements.publish': {
      const title = cleanInput(input.title, 100)
      const body = cleanInput(input.body, 2000)
      if (title.length < 2 || body.length < 2) throw new Error('Enter an announcement title and message.')
      await db.insert(adminControlRecords).values({ id: randomUUID(), recordType: 'announcement', actorUserId: actor.id, action: 'announcement.publish', status: 'active', payload: { title, body }, updatedAt: now })
      await logAdminAction(actor.id, 'announcement.publish', null, { title })
      return { summary: 'Announcement published to the F.R.I.E.N.D.S workspace.' }
    }
    default:
      throw new Error('This admin tool is not available.')
  }
}

export function isAdminToolId(value: string): value is AdminToolId {
  return adminTools.some((tool) => tool.id === value)
}
