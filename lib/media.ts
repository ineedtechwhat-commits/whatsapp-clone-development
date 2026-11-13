export const MAX_CHAT_ATTACHMENTS = 5
export const MAX_CHAT_FILE_BYTES = 20 * 1024 * 1024
export const MAX_STATUS_FILE_BYTES = 50 * 1024 * 1024
export const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024
export const MAX_PROFILE_BANNER_BYTES = 8 * 1024 * 1024

export const PROFILE_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

export function isProfilePhotoPathname(pathname: string, userId: string) {
  const segments = pathname.split('/')
  return pathname.length <= 512 &&
    segments.length === 4 &&
    segments[0] === 'users' &&
    segments[1] === userId &&
    segments[2] === 'profile' &&
    /^[A-Za-z0-9_-]{1,200}$/.test(segments[3])
}

export const STATUS_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
] as const

export const INLINE_MEDIA_TYPES = new Set([
  ...STATUS_MEDIA_TYPES.filter((type) => type.startsWith('image/')),
  ...STATUS_MEDIA_TYPES.filter((type) => type.startsWith('video/')),
  'audio/aac',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
])

export function safeDisplayName(value: string) {
  return value.replace(/[\\/\u0000-\u001f\u007f]/g, '_').trim().slice(0, 180) || 'download'
}

export function mediaUrl(pathname: string) {
  return `/api/media?pathname=${encodeURIComponent(pathname)}`
}

export function profileImageUrl(image: string | null, userId: string) {
  return image && isProfilePhotoPathname(image, userId) ? mediaUrl(image) : image
}
