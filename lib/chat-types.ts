export type Visibility = 'everyone' | 'contacts' | 'nobody'
export type MessageTimer = 'off' | '24h' | '7d' | '90d'

export type ChatPreferences = {
  lastSeenVisibility: Visibility
  profilePhotoVisibility: Visibility
  aboutVisibility: Visibility
  statusVisibility: Visibility
  readReceipts: boolean
  defaultMessageTimer: MessageTimer
  groupInvitePolicy: Visibility
  callsPrivacy: Visibility
  securityNotifications: boolean
}

export type ChatUser = {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  about: string
}

export type Contact = {
  id: string
  name: string
  email: string
  image: string | null
  about: string
}

export type ConversationPreview = {
  id: string
  name: string
  image: string | null
  isGroup: boolean
  lastMessage: string | null
  lastMessageAt: string
  unreadCount: number
  participantCount: number
}

export type StatusItem = {
  id: string
  caption: string
  createdAt: string
  expiresAt: string
  mediaUrl: string | null
  mediaType: string | null
  mediaName: string | null
  mediaSize: number | null
}

export type MessageAttachment = {
  id: string
  filename: string
  contentType: string
  size: number
  url: string
}

export type StatusGroup = {
  userId: string
  name: string
  image: string | null
  isMe: boolean
  items: StatusItem[]
}

export type ChatMessage = {
  id: string
  conversationId: string
  senderId: string
  senderName: string
  senderImage: string | null
  body: string
  createdAt: string
  editedAt: string | null
  attachments: MessageAttachment[]
}

export type WorkspaceData = {
  user: ChatUser
  preferences: ChatPreferences
  conversations: ConversationPreview[]
  contacts: Contact[]
  statuses: StatusGroup[]
}
