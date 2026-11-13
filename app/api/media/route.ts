import { get } from '@vercel/blob'
import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth-session'
import { db } from '@/lib/db'
import { conversationMembers, messageAttachments, messages, statuses, userProfiles, users } from '@/lib/db/schema'
import { INLINE_MEDIA_TYPES, safeDisplayName } from '@/lib/media'

export const dynamic = 'force-dynamic'

async function findAuthorizedMedia(pathname: string, userId: string) {
  const now = new Date()
  const [attachment] = await db
    .select({ filename: messageAttachments.filename, contentType: messageAttachments.contentType })
    .from(messageAttachments)
    .innerJoin(messages, eq(messages.id, messageAttachments.messageId))
    .innerJoin(conversationMembers, and(
      eq(conversationMembers.conversationId, messageAttachments.conversationId),
      eq(conversationMembers.userId, userId),
    ))
    .where(and(
      eq(messageAttachments.pathname, pathname),
      isNull(messages.deletedAt),
      or(isNull(messages.expiresAt), gt(messages.expiresAt, now)),
    ))
    .limit(1)

  if (attachment) return attachment

  const [status] = await db
    .select({ userId: statuses.userId, filename: statuses.mediaName, contentType: statuses.mediaType })
    .from(statuses)
    .where(and(eq(statuses.mediaPathname, pathname), gt(statuses.expiresAt, now)))
    .limit(1)

  if (!status) {
    const [profilePhoto] = await db
      .select({ userId: users.id, visibility: userProfiles.profilePhotoVisibility })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(eq(users.image, pathname))
      .limit(1)
    const [profileBanner] = profilePhoto ? [] : await db
      .select({ userId: userProfiles.userId, visibility: userProfiles.profilePhotoVisibility })
      .from(userProfiles)
      .where(eq(userProfiles.bannerPathname, pathname))
      .limit(1)
    const profileMedia = profilePhoto ? { ...profilePhoto, filename: 'profile-photo' } : profileBanner ? { ...profileBanner, filename: 'profile-banner' } : null
    if (!profileMedia) return null

    if (profileMedia.userId !== userId) {
      if (profileMedia.visibility === 'nobody') return null
      if (profileMedia.visibility === 'contacts') {
        const ownerMemberships = await db
          .select({ conversationId: conversationMembers.conversationId })
          .from(conversationMembers)
          .where(eq(conversationMembers.userId, profileMedia.userId))
          .limit(100)
        const conversationIds = ownerMemberships.map((membership) => membership.conversationId)
        if (!conversationIds.length) return null

        const [sharedConversation] = await db
          .select({ id: conversationMembers.id })
          .from(conversationMembers)
          .where(and(eq(conversationMembers.userId, userId), inArray(conversationMembers.conversationId, conversationIds)))
          .limit(1)
        if (!sharedConversation) return null
      }
    }

    return { filename: profileMedia.filename, contentType: '' }
  }

  if (status.userId !== userId) {
    const ownerConversations = await db
      .select({ conversationId: conversationMembers.conversationId })
      .from(conversationMembers)
      .where(eq(conversationMembers.userId, status.userId))
      .limit(100)
    const conversationIds = ownerConversations.map((row) => row.conversationId)
    if (!conversationIds.length) return null

    const [sharedConversation] = await db
      .select({ id: conversationMembers.id })
      .from(conversationMembers)
      .where(and(eq(conversationMembers.userId, userId), inArray(conversationMembers.conversationId, conversationIds)))
      .limit(1)
    if (!sharedConversation) return null

    const [profile] = await db
      .select({ statusVisibility: userProfiles.statusVisibility })
      .from(userProfiles)
      .where(eq(userProfiles.userId, status.userId))
      .limit(1)
    if (profile?.statusVisibility === 'nobody') return null
  }

  return { filename: status.filename ?? 'status-media', contentType: status.contentType ?? 'application/octet-stream' }
}

export async function GET(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pathname = new URL(request.url).searchParams.get('pathname')?.trim()
  if (!pathname || pathname.length > 512) return NextResponse.json({ error: 'File not found' }, { status: 404 })

  try {
    const media = await findAuthorizedMedia(pathname, user.id)
    if (!media) return NextResponse.json({ error: 'File not found' }, { status: 404 })

    const result = await get(pathname, {
      access: 'private',
      ifNoneMatch: request.headers.get('if-none-match') ?? undefined,
    })
    if (!result) return NextResponse.json({ error: 'File not found' }, { status: 404 })

    const etag = result.blob.etag
    if (result.statusCode === 304) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: etag, 'Cache-Control': 'private, no-cache' },
      })
    }

    const contentType = (media.contentType || result.blob.contentType || 'application/octet-stream').toLowerCase()
    const isInlineMedia = INLINE_MEDIA_TYPES.has(contentType)
    const filename = safeDisplayName(media.filename)
    return new NextResponse(result.stream, {
      headers: {
        'Content-Type': isInlineMedia ? contentType : 'application/octet-stream',
        'Content-Disposition': `${isInlineMedia ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'X-Content-Type-Options': 'nosniff',
        ETag: etag,
        'Cache-Control': 'private, no-cache',
      },
    })
  } catch {
    return NextResponse.json({ error: 'File could not be loaded.' }, { status: 500 })
  }
}
