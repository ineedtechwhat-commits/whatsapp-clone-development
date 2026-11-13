'use server'

import { randomUUID } from 'node:crypto'
import { and, eq, gt, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { adminControlRecords, conversationMembers, messages, users } from '@/lib/db/schema'
import { getSessionUser } from '@/lib/auth-session'
import type { AdminToolInput } from '@/lib/admin-tools'
import { isAdminToolId, runAdminTool } from '@/lib/admin-service'

function cleanReason(value: string | undefined) {
  const reason = (value ?? '').trim().slice(0, 500)
  return reason || 'No additional details provided.'
}

async function ensureReportNotDuplicated(actorId: string, subjectId: string, action: string) {
  const [existing] = await db.select({ id: adminControlRecords.id }).from(adminControlRecords).where(and(
    eq(adminControlRecords.recordType, 'report'),
    eq(adminControlRecords.actorUserId, actorId),
    eq(adminControlRecords.subjectUserId, subjectId),
    eq(adminControlRecords.action, action),
    eq(adminControlRecords.status, 'open'),
    gt(adminControlRecords.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
  )).limit(1)
  if (existing) throw new Error('You have already reported this recently.')
}

export async function submitMessageReportAction(messageIdInput: string, reasonInput?: string) {
  const reporter = await getSessionUser()
  if (!reporter) throw new Error('Unauthorized')
  const messageId = messageIdInput.trim().slice(0, 128)
  if (!messageId) throw new Error('Message not found.')

  const [message] = await db.select({ id: messages.id, conversationId: messages.conversationId, senderId: messages.senderId })
    .from(messages).where(eq(messages.id, messageId)).limit(1)
  if (!message || message.senderId === reporter.id) throw new Error('This message cannot be reported.')

  const [membership] = await db.select({ id: conversationMembers.id }).from(conversationMembers).where(and(
    eq(conversationMembers.userId, reporter.id),
    eq(conversationMembers.conversationId, message.conversationId),
  )).limit(1)
  if (!membership) throw new Error('You cannot report a message outside your conversations.')
  await ensureReportNotDuplicated(reporter.id, message.id, 'message.report')

  await db.insert(adminControlRecords).values({
    id: randomUUID(),
    recordType: 'report',
    actorUserId: reporter.id,
    subjectUserId: message.id,
    action: 'message.report',
    status: 'open',
    payload: { reason: cleanReason(reasonInput), conversationId: message.conversationId },
    updatedAt: new Date(),
  })
}

export async function submitUserReportAction(targetUserIdInput: string, reasonInput?: string) {
  const reporter = await getSessionUser()
  if (!reporter) throw new Error('Unauthorized')
  const targetUserId = targetUserIdInput.trim().slice(0, 128)
  if (!targetUserId || targetUserId === reporter.id) throw new Error('This account cannot be reported.')

  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetUserId)).limit(1)
  if (!target) throw new Error('Account not found.')

  const reporterMemberships = await db.select({ conversationId: conversationMembers.conversationId })
    .from(conversationMembers).where(eq(conversationMembers.userId, reporter.id))
  if (!reporterMemberships.length) throw new Error('You can only report accounts you have interacted with.')
  const [sharedConversation] = await db.select({ id: conversationMembers.id }).from(conversationMembers).where(and(
    eq(conversationMembers.userId, targetUserId),
    inArray(conversationMembers.conversationId, reporterMemberships.map((row) => row.conversationId)),
  )).limit(1)
  if (!sharedConversation) throw new Error('You can only report accounts you have interacted with.')
  await ensureReportNotDuplicated(reporter.id, targetUserId, 'user.report')

  await db.insert(adminControlRecords).values({
    id: randomUUID(),
    recordType: 'report',
    actorUserId: reporter.id,
    subjectUserId: targetUserId,
    action: 'user.report',
    status: 'open',
    payload: { reason: cleanReason(reasonInput) },
    updatedAt: new Date(),
  })
}

export async function runAdminToolAction(toolId: string, input: AdminToolInput = {}) {
  if (!isAdminToolId(toolId)) throw new Error('This admin tool is not available.')
  return runAdminTool(toolId, input)
}
