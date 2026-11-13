'use client'

import type { MessageAttachment, StatusItem } from '@/lib/chat-types'
import { INLINE_MEDIA_TYPES } from '@/lib/media'

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function MessageAttachmentCard({ attachment }: { attachment: MessageAttachment }) {
  const contentType = attachment.contentType.toLowerCase()
  const inline = INLINE_MEDIA_TYPES.has(contentType)

  if (inline && contentType.startsWith('image/')) {
    return <img className="message-attachment-image" src={attachment.url} alt={attachment.filename} loading="lazy" />
  }

  if (inline && contentType.startsWith('video/')) {
    return <video className="message-attachment-video" src={attachment.url} controls playsInline preload="metadata" aria-label={attachment.filename} />
  }

  if (inline && contentType.startsWith('audio/')) {
    return <audio className="message-attachment-audio" src={attachment.url} controls preload="metadata" aria-label={attachment.filename} />
  }

  return (
    <a className="message-file-card" href={attachment.url} download={attachment.filename}>
      <span className="message-file-icon" aria-hidden="true">FILE</span>
      <span className="message-file-copy"><strong>{attachment.filename}</strong><small>{formatFileSize(attachment.size)} · Download</small></span>
    </a>
  )
}

export function StatusMediaPreview({ item }: { item: StatusItem }) {
  if (!item.mediaUrl || !item.mediaType) return null
  const contentType = item.mediaType.toLowerCase()

  if (INLINE_MEDIA_TYPES.has(contentType) && contentType.startsWith('image/')) {
    return <img className="status-media-image" src={item.mediaUrl} alt={item.caption || item.mediaName || 'Status photo'} loading="lazy" />
  }

  if (INLINE_MEDIA_TYPES.has(contentType) && contentType.startsWith('video/')) {
    return <video className="status-media-video" src={item.mediaUrl} controls playsInline preload="metadata" aria-label={item.caption || item.mediaName || 'Status video'} />
  }

  return <a className="status-media-download" href={item.mediaUrl} download={item.mediaName || undefined}>Download {item.mediaName || 'status media'}</a>
}
