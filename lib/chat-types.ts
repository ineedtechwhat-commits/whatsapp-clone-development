export type Visibility = 'everyone' | 'contacts' | 'nobody'
export type MessageTimer = 'off' | '24h' | '7d' | '90d'
export type AppTheme = 'dark' | 'light' | 'central' | 'midnight'
export type AvatarDecoration = 'minimal' | 'square' | 'halo' | 'orbit' | 'spark'

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
  notifyMessages: boolean
  notifyGroupMessages: boolean
  notifyMentions: boolean
  notifyReactions: boolean
  notifyInvitations: boolean
  notifyAnnouncements: boolean
  notificationSound: boolean
}

export type ChatUser = {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  bannerImage: string | null
  avatarDecoration: AvatarDecoration
  about: string
  username: string
  createdAt: string
  isAdmin: boolean
}

export type PlatformAnnouncement = {
  id: string
  title: string
  body: string
  createdAt: string
}

export type Contact = {
  id: string
  name: string
  email: string
  image: string | null
  bannerImage: string | null
  avatarDecoration: AvatarDecoration
  createdAt: string
  isAdmin: boolean
  conversationIds: string[]
  about: string
  username: string
  isOnline: boolean
  lastActiveAt: string | null
}

export type ConversationPreview = {
  id: string
  name: string
  image: string | null
  avatarDecoration: AvatarDecoration
  isGroup: boolean
  lastMessage: string | null
  lastMessageAt: string
  unreadCount: number
  participantCount: number
  description: string | null
  role: 'admin' | 'member'
  typingNames: string[]
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
  avatarDecoration: AvatarDecoration
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
  reactions: Array<{ emoji: string; count: number; reacted: boolean }>
  deliveryCount: number
  readCount: number
  pinnedAt: string | null
  replyToMessageId: string | null
}

export type WorkspaceData = {
  user: ChatUser
  preferences: ChatPreferences
  conversations: ConversationPreview[]
  contacts: Contact[]
  statuses: StatusGroup[]
  announcement: PlatformAnnouncement | null
  unreadNotifications: number
}
