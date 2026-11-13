import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { conversationMembers } from '@/lib/db/schema'
import { getSessionUser } from '@/lib/auth-session'
import { MAX_CHAT_FILE_BYTES, MAX_PROFILE_BANNER_BYTES, MAX_PROFILE_PHOTO_BYTES, MAX_STATUS_FILE_BYTES, PROFILE_PHOTO_TYPES, STATUS_MEDIA_TYPES } from '@/lib/media'

type UploadPurpose = 'message' | 'status' | 'profile' | 'banner'
type UploadClientPayload = {
  purpose: UploadPurpose
  conversationId?: string
}

function parseClientPayload(value: string | null | undefined): UploadClientPayload | null {
  if (!value || value.length > 512) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || !('purpose' in parsed)) return null
    const payload = parsed as UploadClientPayload
    if (payload.purpose !== 'message' && payload.purpose !== 'status' && payload.purpose !== 'profile' && payload.purpose !== 'banner') return null
    return payload
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadBody
    const isCompletionCallback = body.type === 'blob.upload-completed'
    const user = isCompletionCallback ? null : await getSessionUser()
    if (!isCompletionCallback && !user) return NextResponse.json({ error: 'Sign in to upload files.' }, { status: 401 })

    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!user) throw new Error('Sign in to upload files.')
        const payload = parseClientPayload(clientPayload)
        if (!payload) throw new Error('Invalid upload request.')

        if (payload.purpose === 'message') {
          const conversationId = typeof payload.conversationId === 'string' ? payload.conversationId.trim() : ''
          if (!/^[A-Za-z0-9_-]{1,80}$/.test(conversationId)) throw new Error('Conversation not found.')

          const [membership] = await db
            .select({ id: conversationMembers.id })
            .from(conversationMembers)
            .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, user.id)))
            .limit(1)
          const expectedPrefix = `users/${user.id}/messages/${conversationId}/`
          if (!membership || !pathname.startsWith(expectedPrefix) || pathname.slice(expectedPrefix.length).includes('/')) {
            throw new Error('Conversation not found.')
          }

          return {
            maximumSizeInBytes: MAX_CHAT_FILE_BYTES,
            addRandomSuffix: true,
            validUntil: Date.now() + 10 * 60 * 1000,
          }
        }

        if (payload.purpose === 'profile' || payload.purpose === 'banner') {
          const expectedPrefix = `users/${user.id}/profile/`
          if (!pathname.startsWith(expectedPrefix) || pathname.slice(expectedPrefix.length).includes('/')) {
            throw new Error(payload.purpose === 'banner' ? 'Invalid profile banner upload.' : 'Invalid profile photo upload.')
          }

          return {
            allowedContentTypes: [...PROFILE_PHOTO_TYPES],
            maximumSizeInBytes: payload.purpose === 'banner' ? MAX_PROFILE_BANNER_BYTES : MAX_PROFILE_PHOTO_BYTES,
            addRandomSuffix: true,
            validUntil: Date.now() + 10 * 60 * 1000,
          }
        }

        const expectedPrefix = `users/${user.id}/statuses/`
        if (!pathname.startsWith(expectedPrefix) || pathname.slice(expectedPrefix.length).includes('/')) {
          throw new Error('Invalid status upload.')
        }

        return {
          allowedContentTypes: [...STATUS_MEDIA_TYPES],
          maximumSizeInBytes: MAX_STATUS_FILE_BYTES,
          addRandomSuffix: true,
          validUntil: Date.now() + 10 * 60 * 1000,
        }
      },
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload could not be authorized.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
