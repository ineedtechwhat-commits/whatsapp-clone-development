'use client'

import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { upload } from '@vercel/blob/client'
import useSWR from 'swr'
import {
  ArrowLeft,
  Bell,
  CheckCheck,
  CircleDot,
  Crown,
  Flag,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Pin,
  ImagePlus,
  Moon,
  Pencil,
  Plus,
  Search,
  Send,
  Settings2,
  Smile,
  Sun,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import { BrandMark } from '@/components/brand-mark'
import {
  createConversationAction,
  createGroupConversationAction,
  createMediaStatusAction,
  createStatusAction,
  deleteMessageAction,
  clearConversationAction,
  deleteConversationAction,
  editMessageAction,
  toggleMessagePinAction,
  sendMessageAction,
  sendMessageWithAttachmentsAction,
  discardMediaUploadsAction,
  toggleMessageReactionAction,
  toggleBlockedUserAction,
  respondToGroupInvitationAction,
} from '@/app/actions/chat'
import { submitMessageReportAction, submitUserReportAction } from '@/app/actions/admin'
import { SettingsPanel } from '@/components/settings-panel'
import { GroupManagementDialog } from '@/components/group-management-dialog'
import { ConversationSettingsDialog } from '@/components/conversation-settings-dialog'
import { ConversationMembersPanel } from '@/components/conversation-members-panel'
import { ProfileCardDialog } from '@/components/profile-card-dialog'
import { formatFileSize, MessageAttachmentCard, StatusMediaPreview } from '@/components/chat-media'
import type { AppTheme, AvatarDecoration, ChatMessage, Contact, ConversationPreview, StatusGroup, WorkspaceData } from '@/lib/chat-types'
import { MAX_CHAT_ATTACHMENTS, MAX_CHAT_FILE_BYTES, MAX_STATUS_FILE_BYTES } from '@/lib/media'

type View = 'chats' | 'status'
type SearchMode = 'chats' | 'messages' | 'people'
type Dialog = 'new-chat' | 'new-group' | 'new-status' | 'settings' | null

type SettingsTab = 'profile' | 'account' | 'privacy' | 'chats' | 'help'

const messageEmojis = ['🙂', '😄', '😂', '🥹', '😉', '😊', '😍', '❤️', '👍', '👏', '🙌', '🙏', '🎉', '✨', '🔥', '👀', '✅', '🫶']

const fetcher = async (url: string): Promise<ChatMessage[]> => {
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('Unable to load messages')
  return response.json()
}

type ChatActivity = { typingNames: string[]; onlineUserIds: string[] }
type ConversationSyncItem = { id: string; lastMessageAt: string }
type NotificationItem = { id: string; type: string; conversationId: string | null; messageId: string | null; title: string; body: string; readAt: string | null; createdAt: string }
type GroupInvitation = { id: string; conversationId: string; inviterName: string; groupName: string | null; createdAt: string }
type PeopleSearchResult = { id: string; name: string; username: string; image: string | null; conversationId: string }
type MessageSearchResult = { id: string; conversationId: string; senderName: string; snippet: string; createdAt: string }

const peopleSearchFetcher = async (url: string): Promise<PeopleSearchResult[]> => {
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('Search unavailable')
  return response.json()
}
const messageSearchFetcher = async (url: string): Promise<MessageSearchResult[]> => {
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('Search unavailable')
  return response.json()
}

const groupInvitationFetcher = async (url: string): Promise<GroupInvitation[]> => {
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('Unable to load group invitations')
  return response.json()
}

const activityFetcher = async (url: string): Promise<ChatActivity> => {
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('Unable to load chat activity')
  return response.json()
}

const notificationFetcher = async (url: string): Promise<NotificationItem[]> => {
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('Unable to load notifications')
  return response.json()
}

const conversationSyncFetcher = async (url: string): Promise<ConversationSyncItem[]> => {
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('Unable to sync conversations')
  return response.json()
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'
}

function Avatar({ name, image, size = 'regular', ring = false, group = false, decoration = 'minimal', onClick }: { name: string; image: string | null; size?: 'regular' | 'large'; ring?: boolean; group?: boolean; decoration?: AvatarDecoration; onClick?: () => void }) {
  const avatar = (
    <span className={`avatar avatar-${size}${ring ? ' avatar-ring' : ''}${group ? ' avatar-group' : ''}${decoration !== 'minimal' ? ` avatar-decoration-${decoration}` : ''}`} aria-hidden="true">
      {group ? <UsersRound /> : image ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>{initials(name)}</span>}
    </span>
  )
  return onClick ? <button className="avatar-profile-trigger" type="button" aria-label={`View ${name}'s profile`} onClick={onClick}>{avatar}</button> : avatar
}

function timeLabel(value: string) {
  const date = new Date(value)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}

function messageDateLabel(value: string) {
  const date = new Date(value)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' as const }),
  }).format(date)
}

function ChatRow({ conversation, active, onSelect, onProfileClick }: { conversation: ConversationPreview; active: boolean; onSelect: () => void; onProfileClick?: () => void }) {
  return (
    <div className={`chat-row${active ? ' is-active' : ''}`}>
      <Avatar name={conversation.name} image={conversation.image} group={conversation.isGroup} decoration={conversation.avatarDecoration} onClick={onProfileClick} />
      <button className="chat-row-select" type="button" onClick={onSelect} aria-label={`Open conversation with ${conversation.name}`}>
        <span className="chat-row-copy">
          <span className="chat-row-top"><strong>{conversation.name}</strong><time>{timeLabel(conversation.lastMessageAt)}</time></span>
          <span className="chat-row-bottom">
            <span className="last-message">{conversation.lastMessage ?? 'Start the conversation'}</span>
            {conversation.unreadCount > 0 ? <span className="unread-count">{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</span> : null}
          </span>
        </span>
      </button>
    </div>
  )
}

function StatusRow({ group, onSelect, onAdd }: { group: StatusGroup; onSelect: () => void; onAdd?: () => void }) {
  return (
    <button className="status-row" type="button" onClick={group.isMe && !group.items.length ? onAdd : onSelect}>
      <span className="status-avatar-wrap">
        <Avatar name={group.name} image={group.image} ring={group.items.length > 0} decoration={group.avatarDecoration} />
        {group.isMe && !group.items.length ? <span className="status-add">+</span> : null}
      </span>
      <span className="status-row-copy">
        <strong>{group.isMe ? 'My status' : group.name}</strong>
        <span>{group.items.length ? `${group.items.length} update${group.items.length === 1 ? '' : 's'}` : 'Tap to add a status'}</span>
      </span>
      {group.isMe && onAdd ? <span className="status-quick-add" onClick={(event) => { event.stopPropagation(); onAdd() }} aria-label="Add a status">+</span> : null}
    </button>
  )
}

export function ChatApp({ initialData, initialTheme }: { initialData: WorkspaceData; initialTheme: AppTheme }) {
  const router = useRouter()
  const [theme, setTheme] = useState<AppTheme>(initialTheme)
  const [view, setView] = useState<View>('chats')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('profile')
  const [profileCardPerson, setProfileCardPerson] = useState<Contact | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(initialData.conversations[0]?.id ?? null)
  const [selectedStatusId, setSelectedStatusId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [searchMode, setSearchMode] = useState<SearchMode>('chats')
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [chatFilter, setChatFilter] = useState<'all' | 'unread' | 'groups'>('all')
  const [messageMenuId, setMessageMenuId] = useState<string | null>(null)
  const [replyingToMessage, setReplyingToMessage] = useState<ChatMessage | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [draft, setDraft] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [statusMediaFile, setStatusMediaFile] = useState<File | null>(null)
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [messageNotice, setMessageNotice] = useState('')
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [groupManagementId, setGroupManagementId] = useState<string | null>(null)
  const [conversationSettingsOpen, setConversationSettingsOpen] = useState(false)
  const [membersPanelOpen, setMembersPanelOpen] = useState(Boolean(initialData.conversations[0]?.isGroup))
  const [mobileThreadOpen, setMobileThreadOpen] = useState(Boolean(initialData.conversations[0]))
  const tailRef = useRef<HTMLDivElement>(null)
  const refreshRequestedForConversation = useRef(new Set<string>())
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const lastTypingSentAt = useRef(0)
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectedConversation = initialData.conversations.find((chat) => chat.id === selectedId) ?? null
  const selectedConversationContact = selectedConversation && !selectedConversation.isGroup
    ? initialData.contacts.find((contact) => contact.conversationIds.includes(selectedConversation.id)) ?? null
    : null
  const messageUrl = selectedId ? `/api/conversations/${encodeURIComponent(selectedId)}/messages` : null
  const { data: messages = [], error: messagesError, mutate: refreshMessages } = useSWR<ChatMessage[]>(messageUrl, fetcher, {
    refreshInterval: 5000,
    revalidateOnFocus: true,
    keepPreviousData: false,
  })
  const activityUrl = selectedId ? `/api/conversations/${encodeURIComponent(selectedId)}/activity` : null
  const { data: activity } = useSWR<ChatActivity>(activityUrl, activityFetcher, { refreshInterval: 2500, revalidateOnFocus: true })
  const { data: notificationsList = [], mutate: refreshNotifications } = useSWR<NotificationItem[]>('/api/notifications', notificationFetcher, { refreshInterval: 15000, revalidateOnFocus: true })
  const { data: syncedConversations } = useSWR<ConversationSyncItem[]>('/api/conversations', conversationSyncFetcher, { refreshInterval: 8000, revalidateOnFocus: true })
  const { data: groupInvitations = [], mutate: refreshGroupInvitations } = useSWR<GroupInvitation[]>('/api/group-invitations', groupInvitationFetcher, { refreshInterval: 30000, revalidateOnFocus: true })
  const searchQuery = filter.trim()
  const peopleSearchUrl = searchMode === 'people' && searchQuery.length >= 2 ? `/api/search?type=people&q=${encodeURIComponent(searchQuery)}` : null
  const messageSearchUrl = searchMode === 'messages' && searchQuery.length >= 2 ? `/api/search?type=messages&q=${encodeURIComponent(searchQuery)}` : null
  const { data: peopleSearchResults = [], error: peopleSearchError } = useSWR<PeopleSearchResult[]>(peopleSearchUrl, peopleSearchFetcher, { keepPreviousData: false })
  const { data: messageSearchResults = [], error: messageSearchError } = useSWR<MessageSearchResult[]>(messageSearchUrl, messageSearchFetcher, { keepPreviousData: false })

  const filteredConversations = useMemo(() => {
    const query = filter.trim().toLowerCase()
    return initialData.conversations.filter((chat) => {
      const matchesQuery = searchMode !== 'chats' || !query || chat.name.toLowerCase().includes(query) || chat.lastMessage?.toLowerCase().includes(query)
      const matchesReadFilter = chatFilter !== 'unread' || chat.unreadCount > 0
      const matchesType = chatFilter !== 'groups' || chat.isGroup
      return matchesQuery && matchesReadFilter && matchesType
    })
  }, [chatFilter, filter, initialData.conversations, searchMode])

  useEffect(() => {
    tailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, selectedId])

  useEffect(() => {
    if (!syncedConversations) return

    const visibleVersions = new Map(initialData.conversations.map((conversation) => [
      conversation.id,
      new Date(conversation.lastMessageAt).getTime(),
    ]))
    const staleConversations = syncedConversations.filter((conversation) => {
      const visibleVersion = visibleVersions.get(conversation.id)
      const incomingVersion = new Date(conversation.lastMessageAt).getTime()
      if (visibleVersion === incomingVersion) {
        refreshRequestedForConversation.current.delete(conversation.id)
        return false
      }
      return true
    })
    const newlyStaleConversations = staleConversations.filter((conversation) =>
      !refreshRequestedForConversation.current.has(conversation.id),
    )

    if (newlyStaleConversations.length) {
      newlyStaleConversations.forEach((conversation) => refreshRequestedForConversation.current.add(conversation.id))
      router.refresh()
    }
  }, [initialData.conversations, router, syncedConversations])

  useEffect(() => {
    if (!selectedMessageId || !messages.some((message) => message.id === selectedMessageId)) return
    document.getElementById(`message-${selectedMessageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const timer = window.setTimeout(() => setSelectedMessageId(null), 2400)
    return () => window.clearTimeout(timer)
  }, [messages, selectedMessageId])

  function openConversation(conversation: ConversationPreview) {
    setSelectedId(conversation.id)
    setMembersPanelOpen(conversation.isGroup)
    setMobileThreadOpen(true)
    setView('chats')
    setEditingMessageId(null)
    setEditDraft('')
    setMessageMenuId(null)
    setReplyingToMessage(null)
    setSelectedFiles([])
    setEmojiPickerOpen(false)
    setError('')
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedId || (!draft.trim() && !selectedFiles.length) || pending) return
    setPending(true)
    setError('')
    const uploadedFiles: Array<{ pathname: string; filename: string }> = []
    try {
      if (selectedFiles.length) {
        for (const file of selectedFiles) {
          const blob = await upload(
            `users/${initialData.user.id}/messages/${selectedId}/${crypto.randomUUID()}`,
            file,
            {
              access: 'private',
              handleUploadUrl: '/api/media/upload',
              clientPayload: JSON.stringify({ purpose: 'message', conversationId: selectedId }),
              contentType: file.type || 'application/octet-stream',
            },
          )
          uploadedFiles.push({ pathname: blob.pathname, filename: file.name })
        }
        await sendMessageWithAttachmentsAction(selectedId, draft, uploadedFiles, replyingToMessage?.conversationId === selectedId ? replyingToMessage.id : null)
      } else {
        await sendMessageAction(selectedId, draft, replyingToMessage?.conversationId === selectedId ? replyingToMessage.id : null)
      }
      setDraft('')
      setReplyingToMessage(null)
      setSelectedFiles([])
      setEmojiPickerOpen(false)
      await refreshMessages()
      router.refresh()
    } catch {
      if (uploadedFiles.length) await discardMediaUploadsAction(uploadedFiles.map((file) => file.pathname)).catch(() => undefined)
      setError('Your message could not be sent. Please try again.')
    } finally {
      setPending(false)
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  async function saveMessageEdit(messageId: string) {
    if (!editDraft.trim() || pending) return
    setPending(true)
    setError('')
    try {
      await editMessageAction(messageId, editDraft)
      setEditingMessageId(null)
      setEditDraft('')
      await refreshMessages()
      router.refresh()
    } catch {
      setError('Your edit could not be saved. Please try again.')
    } finally {
      setPending(false)
    }
  }

  async function removeMessage(messageId: string) {
    if (pending || !window.confirm('Delete this message for everyone in the conversation?')) return
    setPending(true)
    setError('')
    try {
      await deleteMessageAction(messageId)
      setMessageMenuId(null)
      await refreshMessages()
      router.refresh()
    } catch {
      setError('This message could not be deleted. Please try again.')
    } finally {
      setPending(false)
    }
  }

  async function clearActiveConversation() {
    if (!selectedId || pending) return
    setPending(true)
    try {
      await clearConversationAction(selectedId)
      await Promise.all([refreshMessages(), refreshNotifications()])
      router.refresh()
      setMessageNotice('Conversation cleared for everyone.')
    } finally {
      setPending(false)
    }
  }

  async function deleteActiveConversation() {
    if (!selectedId || pending) return
    setPending(true)
    try {
      await deleteConversationAction(selectedId)
      setSelectedId(null)
      setMobileThreadOpen(false)
      setMembersPanelOpen(false)
      setMessageNotice('Conversation removed from your chat list.')
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  async function toggleMessagePin(messageId: string) {
    if (pending) return
    setPending(true)
    setError('')
    try {
      const pinned = await toggleMessagePinAction(messageId)
      setMessageMenuId(null)
      setMessageNotice(pinned ? 'Message pinned to this conversation.' : 'Message unpinned.')
      await refreshMessages()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This message could not be pinned.')
    } finally {
      setPending(false)
    }
  }

  async function reportMessage(messageId: string) {
    if (pending) return
    setPending(true)
    setError('')
    setMessageNotice('')
    try {
      await submitMessageReportAction(messageId, 'Reported from a conversation')
      setMessageMenuId(null)
      setMessageNotice('Thanks. Your report was sent to the moderation team.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This message could not be reported.')
    } finally {
      setPending(false)
    }
  }

  async function reportUser(userId: string) {
    if (pending) return
    setPending(true)
    setError('')
    setMessageNotice('')
    try {
      await submitUserReportAction(userId, 'Reported from a conversation')
      setMessageMenuId(null)
      setMessageNotice('Thanks. Your account report was sent to the moderation team.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This account could not be reported.')
    } finally {
      setPending(false)
    }
  }

  async function blockUser(userId: string) {
    if (pending) return
    setPending(true)
    setError('')
    try {
      await toggleBlockedUserAction(userId)
      setMessageNotice('Your blocked contacts list was updated.')
      setMessageMenuId(null)
      router.refresh()
    } catch {
      setError('This account could not be blocked right now.')
    } finally {
      setPending(false)
    }
  }

  async function reactToMessage(messageId: string, emoji: string) {
    if (pending) return
    setPending(true)
    try {
      await toggleMessageReactionAction(messageId, emoji)
      await refreshMessages()
    } catch {
      setError('Your reaction could not be saved.')
    } finally {
      setPending(false)
    }
  }

  function sendTypingState(typing: boolean) {
    if (!selectedId) return
    void fetch(`/api/conversations/${encodeURIComponent(selectedId)}/activity`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ typing }),
    }).catch(() => undefined)
    if (!typing && typingStopTimer.current) clearTimeout(typingStopTimer.current)
  }

  function handleDraftChange(value: string) {
    setDraft(value)
    const now = Date.now()
    if (value.trim() && selectedId && now - lastTypingSentAt.current > 2500) {
      sendTypingState(true)
      lastTypingSentAt.current = now
    }
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current)
    if (value.trim()) typingStopTimer.current = setTimeout(() => sendTypingState(false), 3500)
    else sendTypingState(false)
  }

  async function openNotification(notification: NotificationItem) {
    await fetch('/api/notifications', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [notification.id] }) })
    await refreshNotifications()
    setNotificationsOpen(false)
    const conversation = initialData.conversations.find((item) => item.id === notification.conversationId)
    if (conversation) openConversation(conversation)
  }

  async function markAllNotificationsRead() {
    const ids = notificationsList.filter((item) => !item.readAt).map((item) => item.id)
    if (!ids.length) return
    await fetch('/api/notifications', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
    await refreshNotifications()
  }

  async function respondToInvitation(invitation: GroupInvitation, accept: boolean) {
    if (pending) return
    setPending(true)
    setError('')
    try {
      await respondToGroupInvitationAction(invitation.id, accept)
      await Promise.all([refreshGroupInvitations(), refreshNotifications()])
      setNotificationsOpen(false)
      if (accept) {
        setSelectedId(invitation.conversationId)
        setMembersPanelOpen(true)
        setView('chats')
        setMobileThreadOpen(true)
        router.refresh()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your invitation response could not be saved.')
    } finally {
      setPending(false)
    }
  }

  async function submitNewConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '')
    setPending(true)
    setError('')
    try {
      const conversationId = await createConversationAction(email)
      setSelectedId(conversationId)
      setMobileThreadOpen(true)
      setView('chats')
      setDialog(null)
      setFilter('')
      setChatFilter('all')
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not start that conversation.')
    } finally {
      setPending(false)
    }
  }

  async function submitNewGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError('')
    try {
      const conversationId = await createGroupConversationAction(
        String(form.get('groupName') ?? ''),
        String(form.get('members') ?? ''),
      )
      setSelectedId(conversationId)
      setMembersPanelOpen(true)
      setMobileThreadOpen(true)
      setView('chats')
      setDialog(null)
      setFilter('')
      setChatFilter('all')
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not create that group.')
    } finally {
      setPending(false)
    }
  }

  async function submitStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const caption = String(form.get('caption') ?? '')
    if (!statusMediaFile && !caption.trim()) {
      setError('Add a caption or choose a photo or video.')
      return
    }
    setPending(true)
    setError('')
    let uploadedPathname = ''
    try {
      if (statusMediaFile) {
        const blob = await upload(
          `users/${initialData.user.id}/statuses/${crypto.randomUUID()}`,
          statusMediaFile,
          {
            access: 'private',
            handleUploadUrl: '/api/media/upload',
            clientPayload: JSON.stringify({ purpose: 'status' }),
            contentType: statusMediaFile.type || 'application/octet-stream',
          },
        )
        uploadedPathname = blob.pathname
        await createMediaStatusAction(caption, blob.pathname, statusMediaFile.name)
      } else {
        await createStatusAction(caption)
      }
      setStatusMediaFile(null)
      setDialog(null)
      setSelectedStatusId(initialData.user.id)
      setView('status')
      router.refresh()
    } catch {
      if (uploadedPathname) await discardMediaUploadsAction([uploadedPathname]).catch(() => undefined)
      setError('Your status could not be posted. Please try again.')
    } finally {
      setPending(false)
    }
  }

  function changeTheme(nextTheme: AppTheme) {
    setTheme(nextTheme)
    document.cookie = `morrow-theme=${nextTheme}; Path=/; Max-Age=31536000; SameSite=Lax`
  }

  function toggleTheme() {
    changeTheme(theme === 'light' ? 'dark' : 'light')
  }

  function openProfileConversation(person: Contact) {
    const conversation = initialData.conversations.find((item) => !item.isGroup && person.conversationIds.includes(item.id))
    if (!conversation) return
    setProfileCardPerson(null)
    openConversation(conversation)
  }

  async function signOut() {
    await authClient.signOut()
    router.replace('/sign-in')
    router.refresh()
  }

  function accountDeleted() {
    setDialog(null)
    router.replace('/sign-in')
    router.refresh()
  }

  function insertEmoji(emoji: string) {
    const textarea = composerRef.current
    const start = textarea?.selectionStart ?? draft.length
    const end = textarea?.selectionEnd ?? draft.length
    const nextDraft = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`
    setDraft(nextDraft)
    setEmojiPickerOpen(false)
    requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(start + emoji.length, start + emoji.length)
    })
  }

  const activeStatus = initialData.statuses.find((group) => group.userId === selectedStatusId) ?? null
  const pinnedMessages = messages.filter((message) => Boolean(message.pinnedAt))

  return (
    <main className={`messenger-shell${mobileThreadOpen ? ' thread-open' : ''}${view === 'chats' && selectedConversation?.isGroup && membersPanelOpen ? ' has-members-panel' : ''}`} data-theme={theme}>
      <nav className="app-rail" aria-label="Main navigation">
        <a className="rail-brand" href="/" aria-label="F.R.I.E.N.D.S home"><BrandMark className="brand-mark" /></a>
        <div className="rail-nav">
          <button className={`rail-button${view === 'chats' ? ' selected' : ''}`} type="button" aria-label="Chats" aria-pressed={view === 'chats'} onClick={() => setView('chats')}>
            <MessageCircle aria-hidden="true" /><span className="rail-tooltip">Chats</span>
          </button>
          <button className={`rail-button${view === 'status' ? ' selected' : ''}`} type="button" aria-label="Status updates" aria-pressed={view === 'status'} onClick={() => setView('status')}>
            <CircleDot aria-hidden="true" /><span className="rail-tooltip">Updates</span>
          </button>
          {initialData.user.isAdmin ? <a className="rail-button admin-rail-button" href="/admin" aria-label="Open admin console"><Crown aria-hidden="true" /><span className="rail-tooltip">Admin console</span></a> : null}
        </div>
        <div className="rail-bottom">
          <button className="rail-button theme-toggle" type="button" aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} aria-pressed={theme !== 'light'} onClick={toggleTheme}>
            {theme === 'light' ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
            <span className="rail-tooltip">Switch to {theme === 'light' ? 'dark' : 'light'} mode</span>
          </button>
          <button className="rail-button" type="button" aria-label="Open settings" onClick={() => { setSettingsTab('privacy'); setDialog('settings') }}>
            <Settings2 aria-hidden="true" /><span className="rail-tooltip">Settings</span>
          </button>
          <button className={`rail-button${initialData.user.isAdmin ? ' creator-profile-button' : ''}`} type="button" aria-label={initialData.user.isAdmin ? 'Edit your creator profile' : 'Edit your profile'} onClick={() => { setSettingsTab('profile'); setDialog('settings') }}>
            <span className="rail-avatar-wrap"><Avatar name={initialData.user.name} image={initialData.user.image} size="regular" decoration={initialData.user.avatarDecoration} />{initialData.user.isAdmin ? <Crown className="rail-admin-crown" aria-hidden="true" /> : null}</span>
          </button>
        </div>
      </nav>

      <aside className="inbox-panel" aria-label={view === 'chats' ? 'Chats' : 'Status updates'}>
        <header className="inbox-header">
          <div className="inbox-title-row">
            <div>
              <p className="inbox-kicker">YOUR SPACE</p>
              <h1>{view === 'chats' ? 'Messages' : 'Updates'}</h1>
            </div>
            <div className="inbox-title-actions">
              <div className="notification-wrap">
                <button className="icon-button notification-trigger" type="button" aria-label={`Notifications${notificationsList.some((item) => !item.readAt) || groupInvitations.length ? `, ${notificationsList.filter((item) => !item.readAt).length + groupInvitations.length} new` : ''}`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}>
                  <Bell aria-hidden="true" />
                  {notificationsList.some((item) => !item.readAt) || groupInvitations.length ? <span className="notification-badge">{notificationsList.filter((item) => !item.readAt).length + groupInvitations.length > 9 ? '9+' : notificationsList.filter((item) => !item.readAt).length + groupInvitations.length}</span> : null}
                </button>
                {notificationsOpen ? <div className="notification-popover" role="region" aria-label="Notifications">
                  <div className="notification-popover-header"><strong>Notifications</strong><button type="button" onClick={() => void markAllNotificationsRead()} disabled={!notificationsList.some((item) => !item.readAt)}>Mark all read</button></div>
                  {groupInvitations.map((invitation) => <div className="group-invitation-item" key={invitation.id}><span><strong>{invitation.groupName || 'Group invitation'}</strong><small>{invitation.inviterName} invited you to join</small></span><div><button type="button" onClick={() => void respondToInvitation(invitation, false)} disabled={pending}>Decline</button><button type="button" onClick={() => void respondToInvitation(invitation, true)} disabled={pending}>Accept</button></div></div>)}
                  {notificationsList.map((notification) => <button className={`notification-item${notification.readAt ? '' : ' unread'}`} type="button" key={notification.id} onClick={() => void openNotification(notification)}><span><strong>{notification.title}</strong><small>{notification.body}</small></span><time>{timeLabel(notification.createdAt)}</time></button>)}
                  {!groupInvitations.length && !notificationsList.length ? <p className="notification-empty">You&apos;re all caught up.</p> : null}
                </div> : null}
              </div>
              <button className="icon-button new-chat-button" type="button" aria-label="Start a new conversation" onClick={() => { setError(''); setDialog('new-chat') }}><Plus aria-hidden="true" /></button>
            </div>
          </div>
          <label className="search-box">
            <Search aria-hidden="true" />
            <span className="sr-only">Search {view === 'chats' ? 'chats' : 'updates'}</span>
            <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={view === 'chats' ? searchMode === 'messages' ? 'Search message text' : searchMode === 'people' ? 'Search people you know' : 'Search conversations' : 'Find an update'} />
            {filter ? <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setFilter('')}><X aria-hidden="true" /></button> : null}
          </label>
          {view === 'chats' ? <>
            <div className="search-mode-tabs" role="group" aria-label="Search in">
              {(['chats', 'messages', 'people'] as SearchMode[]).map((mode) => <button className={searchMode === mode ? 'active' : ''} type="button" aria-pressed={searchMode === mode} key={mode} onClick={() => setSearchMode(mode)}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}
            </div>
            {searchMode === 'chats' ? <div className="inbox-filters" aria-label="Conversation filter">
              <button className={`filter-pill${chatFilter === 'all' ? ' active' : ''}`} type="button" aria-pressed={chatFilter === 'all'} onClick={() => setChatFilter('all')}>All</button>
              <button className={`filter-pill${chatFilter === 'unread' ? ' active' : ''}`} type="button" aria-pressed={chatFilter === 'unread'} onClick={() => setChatFilter('unread')}>Unread</button>
              <button className={`filter-pill${chatFilter === 'groups' ? ' active' : ''}`} type="button" aria-pressed={chatFilter === 'groups'} onClick={() => setChatFilter('groups')}>Groups</button>
            </div> : null}
          </> : null}
        </header>

        {initialData.announcement ? <aside className="platform-announcement" aria-label="Platform announcement"><strong>{initialData.announcement.title}</strong><p>{initialData.announcement.body}</p></aside> : null}
        {messageNotice ? <p className="inline-notice" role="status">{messageNotice}</p> : null}

        {view === 'chats' ? (
          <div className="inbox-list" role="list" aria-label={searchMode === 'chats' ? 'Conversation list' : `${searchMode} search results`}>
            {searchMode === 'chats' ? filteredConversations.length ? filteredConversations.map((conversation) => {
              const contact = initialData.contacts.find((person) => person.conversationIds.includes(conversation.id))
              return (
                <div role="listitem" key={conversation.id}>
                  <ChatRow conversation={conversation} active={selectedId === conversation.id} onSelect={() => openConversation(conversation)} onProfileClick={contact ? () => setProfileCardPerson(contact) : undefined} />
                </div>
              )
            }) : (
              <div className="list-empty">
                <span className="empty-icon"><MessageCircle aria-hidden="true" /></span>
                <strong>{filter ? 'No matches found' : 'Your conversations start here'}</strong>
                <p>{filter ? 'Try another conversation name.' : 'Find someone you know and say hello.'}</p>
                {!filter ? <button className="text-action" type="button" onClick={() => setDialog('new-chat')}>Start a conversation <span aria-hidden="true">→</span></button> : null}
              </div>
            ) : searchQuery.length < 2 ? <p className="search-guidance">Type at least two characters to search {searchMode}.</p> : searchMode === 'people' ? peopleSearchError ? <p className="search-guidance" role="status">People search is unavailable right now.</p> : peopleSearchResults.length ? peopleSearchResults.map((person) => {
              const conversation = initialData.conversations.find((item) => item.id === person.conversationId)
              return <button className="search-result-row" type="button" key={person.id} onClick={() => { if (conversation) openConversation(conversation) }}><Avatar name={person.name} image={person.image} /><span><strong>{person.name}</strong><small>@{person.username} · existing contact</small></span></button>
            }) : <p className="search-guidance">No people in your existing conversations match.</p> : messageSearchError ? <p className="search-guidance" role="status">Message search is unavailable right now.</p> : messageSearchResults.length ? messageSearchResults.map((result) => {
              const conversation = initialData.conversations.find((item) => item.id === result.conversationId)
              return <button className="search-result-row message-search-result" type="button" key={result.id} onClick={() => { if (conversation) { setSelectedMessageId(result.id); openConversation(conversation) } }}><span className="search-result-copy"><strong>{conversation?.name ?? 'Conversation'}</strong><small>{result.senderName} · {timeLabel(result.createdAt)}</small><span>{result.snippet}</span></span></button>
            }) : <p className="search-guidance">No messages match your search.</p>}
          </div>
        ) : (
          <div className="inbox-list status-list" role="list" aria-label="Status updates">
            <div className="status-section-label">TODAY</div>
            <StatusRow group={{ userId: initialData.user.id, name: 'You', image: initialData.user.image, avatarDecoration: initialData.user.avatarDecoration, isMe: true, items: initialData.statuses.find((group) => group.isMe)?.items ?? [] }} onSelect={() => setSelectedStatusId(initialData.user.id)} onAdd={() => { setError(''); setStatusMediaFile(null); setDialog('new-status') }} />
            {initialData.statuses.filter((group) => !group.isMe && (!filter || group.name.toLowerCase().includes(filter.toLowerCase()))).map((group) => (
              <StatusRow key={group.userId} group={group} onSelect={() => setSelectedStatusId(group.userId)} />
            ))}
            {!initialData.statuses.some((group) => !group.isMe) ? <p className="status-empty-note">Updates from people you chat with will appear here.</p> : null}
            <button className="text-action status-compose-link" type="button" onClick={() => { setError(''); setStatusMediaFile(null); setDialog('new-status') }}>Share a new update <span aria-hidden="true">+</span></button>
          </div>
        )}
        <footer className="inbox-footer"><span className="online-dot" /> Your conversations are private</footer>
      </aside>

      {view === 'chats' ? (
        <section className={`conversation-panel${selectedConversation ? '' : ' conversation-empty'}`} aria-label="Conversation">
          {selectedConversation ? (
            <>
              <header className="conversation-header">
                <button className="back-button" type="button" aria-label="Back to conversations" onClick={() => setMobileThreadOpen(false)}><ArrowLeft aria-hidden="true" /></button>
                <Avatar name={selectedConversation.name} image={selectedConversation.image} group={selectedConversation.isGroup} decoration={selectedConversationContact?.avatarDecoration ?? selectedConversation.avatarDecoration} onClick={selectedConversationContact ? () => setProfileCardPerson(selectedConversationContact) : undefined} />
                <div className="conversation-heading"><h2>{selectedConversation.name}</h2><p>{activity?.typingNames.length ? `${activity.typingNames.join(', ')} typing…` : selectedConversation.isGroup ? `Group · ${selectedConversation.participantCount} members` : activity?.onlineUserIds.length ? 'online' : 'Conversation'}</p></div>
                {selectedConversation.isGroup ? <button className={`group-details-button member-panel-toggle${membersPanelOpen ? ' is-active' : ''}`} type="button" aria-label={membersPanelOpen ? 'Hide group members' : 'Show group members'} aria-expanded={membersPanelOpen} aria-controls={membersPanelOpen ? 'conversation-member-panel' : undefined} onClick={() => setMembersPanelOpen((open) => !open)}><UsersRound aria-hidden="true" /><span>Members</span></button> : null}
                <button className="group-details-button" type="button" aria-label={`Conversation settings for ${selectedConversation.name}`} onClick={() => setConversationSettingsOpen(true)}><Settings2 aria-hidden="true" /><span>Settings</span></button>
              </header>
              {pinnedMessages.length ? <div className="pinned-message-strip" role="group" aria-label={`Pinned messages, ${pinnedMessages.length} of 3`}>
                <span className="pinned-message-label"><Pin aria-hidden="true" /><strong>Pinned</strong><small>{pinnedMessages.length}/3</small></span>
                <div className="pinned-message-list">{pinnedMessages.map((message) => <button type="button" key={message.id} onClick={() => { setSelectedMessageId(message.id); document.getElementById(`message-${message.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }} aria-label={`Jump to pinned message from ${message.senderName}`}><span>{message.body || (message.attachments.length ? 'Attachment' : 'Message')}</span><small>{message.senderName}</small></button>)}</div>
              </div> : null}
              <div className="message-history" role="log" aria-live="polite" aria-label={`Messages with ${selectedConversation.name}`}>
                {messagesError ? <div className="message-load-error">Messages could not be refreshed. Your conversation is still available.</div> : null}
                {messages.map((message, index) => {
              const previousMessage = messages[index - 1]
              const isDateBoundary = !previousMessage || new Date(previousMessage.createdAt).toDateString() !== new Date(message.createdAt).toDateString()
              const currentMessageTime = new Date(message.createdAt).getTime()
              const previousMessageTime = previousMessage ? new Date(previousMessage.createdAt).getTime() : 0
              const isGroupedWithPrevious = Boolean(previousMessage && !isDateBoundary && previousMessage.senderId === message.senderId && currentMessageTime >= previousMessageTime && currentMessageTime - previousMessageTime < 5 * 60 * 1000)
              const mine = message.senderId === initialData.user.id
              const messageContact = initialData.contacts.find((contact) => contact.id === message.senderId)
              const editing = editingMessageId === message.id
              return (
                    <Fragment key={message.id}>
                      {isDateBoundary ? <div className="history-note"><span>{messageDateLabel(message.createdAt)}</span></div> : null}
                    <article id={`message-${message.id}`} className={`message-line${mine ? ' message-mine' : ''}${isGroupedWithPrevious ? ' message-grouped' : ''}${selectedMessageId === message.id ? ' message-search-highlight' : ''}`}>
                      {!mine && !isGroupedWithPrevious ? <Avatar name={message.senderName} image={message.senderImage} size="regular" decoration={messageContact?.avatarDecoration} onClick={messageContact ? () => setProfileCardPerson(messageContact) : undefined} /> : null}
                      <div className={`message-content${mine ? ' message-content-mine' : ''}`}>
                        {!mine && !isGroupedWithPrevious && selectedConversation.isGroup ? <span className="message-sender">{message.senderName}</span> : null}
                        {editing ? (
                          <form className="message-edit-form" onSubmit={(event) => { event.preventDefault(); void saveMessageEdit(message.id) }}>
                            <label className="sr-only" htmlFor={`edit-${message.id}`}>Edit message</label>
                            <textarea id={`edit-${message.id}`} value={editDraft} onChange={(event) => setEditDraft(event.target.value)} rows={3} maxLength={4000} autoFocus />
                            <div><button type="button" onClick={() => { setEditingMessageId(null); setEditDraft('') }}>Cancel</button><button type="submit" disabled={pending || !editDraft.trim()}>Save</button></div>
                          </form>
                        ) : (
                          <div className="message-bubble">
                            {message.replyToMessageId ? <div className="message-reply-quote"><strong>{message.replyTo?.senderName ?? 'Original message'}</strong><span>{message.replyTo ? message.replyTo.body || 'Attachment' : 'This message is no longer available.'}</span></div> : null}
                            {message.body ? <p>{message.body}</p> : null}
                            {message.attachments.length ? <div className="message-attachments">{message.attachments.map((attachment) => <MessageAttachmentCard key={attachment.id} attachment={attachment} />)}</div> : null}
                            <div className="message-meta">{message.pinnedAt ? <span className="message-pinned-indicator" title="Pinned message"><Pin aria-label="Pinned message" /></span> : null}<time>{timeLabel(message.createdAt)}{message.editedAt ? <span className="edited-label"> · edited</span> : null}</time>{mine && (selectedConversation.isGroup || initialData.preferences.readReceipts) ? <span className="message-receipt" title={`${message.readCount} read · ${message.deliveryCount} delivered`}><CheckCheck className="message-check" aria-label={`${message.readCount} read`} />{message.readCount ? <small>{message.readCount}</small> : null}</span> : null}</div>
                          </div>
                        )}
                        {!editing ? (
                          <div className="message-options">
                            <button className="message-more-button" type="button" aria-label={`More options for ${mine ? 'your' : `${message.senderName}'s`} message`} aria-expanded={messageMenuId === message.id} onClick={() => setMessageMenuId((current) => current === message.id ? null : message.id)}><MoreHorizontal aria-hidden="true" /></button>
                            {messageMenuId === message.id ? (
                              <div className="message-menu" role="group" aria-label="Message actions">
                                <div className="message-reaction-options" role="group" aria-label="React to message">
                                  {['👍', '❤️', '😂', '😮', '😢', '🙏'].map((emoji) => <button type="button" key={emoji} aria-label={`React with ${emoji}`} onClick={() => { setMessageMenuId(null); void reactToMessage(message.id, emoji) }}>{emoji}</button>)}
                                </div>
                                <button type="button" onClick={() => void toggleMessagePin(message.id)} disabled={pending}><Pin aria-hidden="true" /> {message.pinnedAt ? 'Unpin message' : 'Pin message'}</button>
                                <button type="button" onClick={() => { setReplyingToMessage(message); setMessageMenuId(null); composerRef.current?.focus() }}><MessageCircle aria-hidden="true" /> Reply</button>
                                {mine ? <>
                                  <button type="button" onClick={() => { setEditingMessageId(message.id); setEditDraft(message.body); setMessageMenuId(null) }}><Pencil aria-hidden="true" /> Edit</button>
                                  <button type="button" onClick={() => void removeMessage(message.id)}><Trash2 aria-hidden="true" /> Delete for everyone</button>
                                </> : <>
                                  <button type="button" onClick={() => void reportMessage(message.id)} disabled={pending}><Flag aria-hidden="true" /> Report message</button>
                                  <button type="button" onClick={() => void reportUser(message.senderId)} disabled={pending}><Flag aria-hidden="true" /> Report account</button>
                                  <button type="button" onClick={() => void blockUser(message.senderId)} disabled={pending}><X aria-hidden="true" /> Block account</button>
                                </>}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {message.reactions.length ? <div className="message-reactions" aria-label="Message reactions">{message.reactions.map((reaction) => <button type="button" key={reaction.emoji} aria-pressed={reaction.reacted} onClick={() => void reactToMessage(message.id, reaction.emoji)}>{reaction.emoji}<span>{reaction.count}</span></button>)}</div> : null}
                      </div>
                    </article>
                    </Fragment>
                  )
                })}
                {!messages.length && !messagesError ? <div className="first-message-note">This is the beginning of your conversation. Say hello.</div> : null}
                <div ref={tailRef} />
              </div>
              <form className="composer" onSubmit={submitMessage}>
                {replyingToMessage ? <div className="composer-reply-preview" role="status"><span><strong>Replying to {replyingToMessage.senderName}</strong><small>{replyingToMessage.body || (replyingToMessage.attachments.length ? 'Attachment' : 'Message')}</small></span><button type="button" aria-label="Cancel reply" onClick={() => setReplyingToMessage(null)}><X aria-hidden="true" /></button></div> : null}
                {selectedFiles.length ? (
                  <div className="attachment-queue" aria-label="Files attached to your message">
                    {selectedFiles.map((file, index) => (
                      <div className="attachment-queue-item" key={`${file.name}-${index}`}>
                        <span><strong>{file.name}</strong><small>{formatFileSize(file.size)}</small></span>
                        <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setSelectedFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X aria-hidden="true" /></button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="composer-row">
                  <input
                    ref={attachmentInputRef}
                    className="sr-only"
                    type="file"
                    multiple
                    onChange={(event) => {
                      const pickedFiles = Array.from(event.currentTarget.files ?? [])
                      event.currentTarget.value = ''
                      if (!pickedFiles.length) return
                      if (pickedFiles.some((file) => file.size > MAX_CHAT_FILE_BYTES)) {
                        setError('Each attachment must be 20 MB or smaller.')
                        return
                      }
                      if (selectedFiles.length + pickedFiles.length > MAX_CHAT_ATTACHMENTS) {
                        setError(`Send up to ${MAX_CHAT_ATTACHMENTS} files at a time.`)
                        return
                      }
                      setError('')
                      setSelectedFiles((current) => [...current, ...pickedFiles])
                    }}
                  />
                  <button className="composer-attachment-trigger" type="button" aria-label="Attach files" onClick={() => attachmentInputRef.current?.click()}><Paperclip aria-hidden="true" /></button>
                  <div className="emoji-picker-wrap">
                    <button className="emoji-trigger" type="button" aria-label="Add an emoji" aria-expanded={emojiPickerOpen} onClick={() => setEmojiPickerOpen((open) => !open)}><Smile aria-hidden="true" /></button>
                    {emojiPickerOpen ? (
                      <div className="emoji-picker" role="group" aria-label="Choose an emoji">
                        {messageEmojis.map((emoji) => <button key={emoji} type="button" aria-label={`Insert ${emoji}`} onClick={() => insertEmoji(emoji)}>{emoji}</button>)}
                      </div>
                    ) : null}
                  </div>
                  <label className="composer-field" htmlFor="message-composer">
                    <span className="sr-only">Write a message</span>
                    <textarea id="message-composer" ref={composerRef} value={draft} onChange={(event) => handleDraftChange(event.target.value)} onBlur={() => sendTypingState(false)} onKeyDown={onComposerKeyDown} placeholder="Write a message" rows={1} maxLength={4000} />
                  </label>
                  <button className="send-button" type="submit" aria-label="Send message" disabled={(!draft.trim() && !selectedFiles.length) || pending}>
                    <Send aria-hidden="true" />
                  </button>
                </div>
              </form>
              {error ? <p className="inline-error" role="status">{error}</p> : null}
            </>
          ) : (
            <WelcomePanel onNewChat={() => { setError(''); setDialog('new-chat') }} />
          )}
        </section>
      ) : (
        <section className="conversation-panel status-detail-panel" aria-label="Status details">
          <header className="conversation-header status-detail-header">
            <span className="header-avatar"><CircleDot aria-hidden="true" /></span>
            <div className="conversation-heading"><h2>Daily moments</h2><p>Short updates from your people</p></div>
            <button className="solid-small-button" type="button" onClick={() => { setError(''); setStatusMediaFile(null); setDialog('new-status') }}><Plus aria-hidden="true" /> New update</button>
          </header>
          <div className="status-detail-content">
            {activeStatus ? (
              <article className="status-card">
                <div className="status-card-person"><Avatar name={activeStatus.name} image={activeStatus.image} ring decoration={activeStatus.avatarDecoration} /><div><strong>{activeStatus.name}</strong><span>{activeStatus.items.length} update{activeStatus.items.length === 1 ? '' : 's'}</span></div></div>
                {activeStatus.items.map((item) => (
                  <div className="status-story" key={item.id}>
                    <StatusMediaPreview item={item} />
                    {item.caption ? <p>{item.caption}</p> : null}
                    <time>Expires {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(item.expiresAt))}</time>
                  </div>
                ))}
              </article>
            ) : (
              <div className="welcome-card status-welcome">
                <span className="welcome-mark"><CircleDot aria-hidden="true" /></span>
                <p className="eyebrow">A little window into their day</p>
                <h2>Good things are better shared.</h2>
                <p>Post a quick update for the people you chat with. Updates disappear after 24 hours.</p>
                <button className="solid-button" type="button" onClick={() => { setError(''); setStatusMediaFile(null); setDialog('new-status') }}><Plus aria-hidden="true" /> Share an update</button>
              </div>
            )}
          </div>
        </section>
      )}

      {view === 'chats' && selectedConversation?.isGroup && membersPanelOpen ? (
        <ConversationMembersPanel
          conversationId={selectedConversation.id}
          groupName={selectedConversation.name}
          description={selectedConversation.description}
          onClose={() => setMembersPanelOpen(false)}
          onProfileClick={(memberId) => {
            const person = initialData.contacts.find((contact) => contact.id === memberId)
            if (person) setProfileCardPerson(person)
          }}
        />
      ) : null}

      {profileCardPerson ? (
        <ProfileCardDialog
          person={profileCardPerson}
          onClose={() => setProfileCardPerson(null)}
          onMessage={initialData.conversations.some((item) => !item.isGroup && profileCardPerson.conversationIds.includes(item.id)) ? () => openProfileConversation(profileCardPerson) : undefined}
        />
      ) : null}

      {dialog === 'settings' ? (
        <SettingsPanel
          user={initialData.user}
          initialPreferences={initialData.preferences}
          initialTab={settingsTab}
          theme={theme}
          onClose={() => setDialog(null)}
          onThemeChange={changeTheme}
          onSignOut={signOut}
          onAccountDeleted={accountDeleted}
        />
      ) : dialog ? (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setDialog(null); setError('') } }}>
          <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
            <header className="dialog-header"><div><p className="inbox-kicker">F.R.I.E.N.D.S</p><h2 id="dialog-title">{dialog === 'new-chat' ? 'Start a conversation' : dialog === 'new-group' ? 'Create a group' : 'Share an update'}</h2></div><button className="icon-button" type="button" aria-label="Close" onClick={() => { setDialog(null); setError('') }}><X aria-hidden="true" /></button></header>
            {dialog === 'new-chat' ? (
              <form className="dialog-form" onSubmit={submitNewConversation}>
                <label htmlFor="recipient-email">Their account email</label>
                <input id="recipient-email" name="email" type="email" autoComplete="email" placeholder="name@example.com" required maxLength={254} />
                <p className="dialog-hint">They need a F.R.I.E.N.D.S account before you can message them.</p>
                {error ? <p className="form-error" role="alert">{error}</p> : null}
                <button className="solid-button dialog-submit" type="submit" disabled={pending}>{pending ? 'Starting…' : 'Continue'}</button>
                <button className="text-action group-switch-link" type="button" onClick={() => { setError(''); setDialog('new-group') }}><UsersRound aria-hidden="true" /> Create a group instead</button>
              </form>
            ) : null}
            {dialog === 'new-group' ? (
              <form className="dialog-form" onSubmit={submitNewGroup}>
                <label htmlFor="group-name">Group name</label>
                <input id="group-name" name="groupName" type="text" autoComplete="off" placeholder="Weekend plans" required minLength={2} maxLength={80} />
                <label htmlFor="group-members">Member email addresses</label>
                <textarea id="group-members" name="members" rows={4} placeholder="alex@example.com, sam@example.com" required />
                <p className="dialog-hint">Add up to 99 people who already have an account. Separate addresses with commas or spaces.</p>
                {error ? <p className="form-error" role="alert">{error}</p> : null}
                <div className="group-form-actions">
                  <button className="text-action" type="button" onClick={() => { setError(''); setDialog('new-chat') }}>Back</button>
                  <button className="solid-button" type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create group'}</button>
                </div>
              </form>
            ) : null}
            {dialog === 'new-status' ? (
              <form className="dialog-form" onSubmit={submitStatus}>
                <label htmlFor="status-caption">Caption <span>(optional)</span></label>
                <textarea id="status-caption" name="caption" rows={3} maxLength={280} placeholder="A small moment from your day…" />
                <label htmlFor="status-media">Photo or video</label>
                <input
                  id="status-media"
                  className="status-file-input"
                  type="file"
                  accept="image/*,video/*"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0] ?? null
                    event.currentTarget.value = ''
                    if (file && file.size > MAX_STATUS_FILE_BYTES) {
                      setError('Status photos and videos must be 50 MB or smaller.')
                      return
                    }
                    if (file && !file.type.startsWith('image/') && !file.type.startsWith('video/')) {
                      setError('Choose a photo or video file.')
                      return
                    }
                    setError('')
                    setStatusMediaFile(file)
                  }}
                />
                {statusMediaFile ? (
                  <div className="status-file-selection">
                    <span><ImagePlus aria-hidden="true" /><strong>{statusMediaFile.name}</strong><small>{formatFileSize(statusMediaFile.size)}</small></span>
                    <button type="button" aria-label="Remove selected status media" onClick={() => setStatusMediaFile(null)}><X aria-hidden="true" /></button>
                  </div>
                ) : null}
                <p className="dialog-hint">Visible to people you have a conversation with. Photos and videos up to 50 MB disappear after 24 hours.</p>
                {error ? <p className="form-error" role="alert">{error}</p> : null}
                <button className="solid-button dialog-submit" type="submit" disabled={pending}>{pending ? 'Sharing…' : 'Share update'}</button>
              </form>
            ) : null}

          </section>
        </div>
      ) : null}
      {conversationSettingsOpen && selectedConversation ? <ConversationSettingsDialog
        conversationName={selectedConversation.name}
        isGroup={selectedConversation.isGroup}
        onClose={() => setConversationSettingsOpen(false)}
        onClear={clearActiveConversation}
        onDelete={deleteActiveConversation}
        onManageGroup={() => {
          setConversationSettingsOpen(false)
          setGroupManagementId(selectedConversation.id)
        }}
      /> : null}
      {groupManagementId ? (() => {
        const group = initialData.conversations.find((conversation) => conversation.id === groupManagementId && conversation.isGroup)
        return group ? <GroupManagementDialog conversationId={group.id} groupName={group.name} description={group.description} viewerId={initialData.user.id} viewerRole={group.role} onClose={() => setGroupManagementId(null)} onLeft={() => { setGroupManagementId(null); setSelectedId(null); setMobileThreadOpen(false) }} /> : null
      })() : null}
    </main>
  )
}

function WelcomePanel({ onNewChat }: { onNewChat: () => void }) {
  return (
    <div className="welcome-panel">
      <div className="welcome-card">
        <span className="welcome-mark"><MessageCircle aria-hidden="true" /></span>
        <p className="eyebrow">A softer kind of inbox</p>
        <h2>Make room for a real conversation.</h2>
        <p>Pick up where you left off, or start something new with someone you know.</p>
        <button className="solid-button" type="button" onClick={onNewChat}><Plus aria-hidden="true" /> Start a conversation</button>
      </div>
      <div className="welcome-assurance"><Settings2 aria-hidden="true" /> Your profile and conversations are tied to your Google account.</div>
    </div>
  )
}
