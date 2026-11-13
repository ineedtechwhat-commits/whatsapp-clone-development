import 'server-only'

import { and, desc, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { adminControlRecords } from '@/lib/db/schema'

export async function getUserAccessState(userId: string) {
  const [roleRows, restrictionRows] = await Promise.all([
    db.select({ id: adminControlRecords.id })
      .from(adminControlRecords)
      .where(and(
        eq(adminControlRecords.recordType, 'role'),
        eq(adminControlRecords.roleUserId, userId),
        eq(adminControlRecords.action, 'admin'),
        eq(adminControlRecords.status, 'active'),
      ))
      .limit(1),
    db.select({ status: adminControlRecords.status })
      .from(adminControlRecords)
      .where(and(
        eq(adminControlRecords.recordType, 'restriction'),
        eq(adminControlRecords.subjectUserId, userId),
      ))
      .orderBy(desc(adminControlRecords.createdAt))
      .limit(1),
  ])

  const isAdmin = Boolean(roleRows[0])
  const isRestricted = !isAdmin && restrictionRows[0]?.status === 'active'
  return { isAdmin, isRestricted }
}

export async function getRawSessionUser() {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user ?? null
}

export async function getSessionUser() {
  const user = await getRawSessionUser()
  if (!user) return null

  const access = await getUserAccessState(user.id)
  return access.isRestricted ? null : user
}

export async function isAdminUserId(userId: string) {
  const access = await getUserAccessState(userId)
  return access.isAdmin
}

export async function requireAdminUser() {
  const user = await getRawSessionUser()
  if (!user) throw new Error('Unauthorized')

  const access = await getUserAccessState(user.id)
  if (!access.isAdmin) throw new Error('Forbidden')
  return user
}
