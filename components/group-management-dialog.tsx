'use client'

import { useState, type FormEvent } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { ShieldCheck, UserMinus, UsersRound, X } from 'lucide-react'
import { inviteGroupMemberAction, leaveGroupAction, removeGroupMemberAction, updateGroupDetailsAction } from '@/app/actions/chat'

type GroupMember = { id: string; name: string; image: string | null; role: 'admin' | 'member'; joinedAt: string }
const memberFetcher = async (url: string): Promise<GroupMember[]> => {
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('Unable to load group members')
  return response.json()
}

export function GroupManagementDialog({ conversationId, groupName, description, viewerId, viewerRole, onClose, onLeft }: {
  conversationId: string
  groupName: string
  description: string | null
  viewerId: string
  viewerRole: 'admin' | 'member'
  onClose: () => void
  onLeft: () => void
}) {
  const router = useRouter()
  const [title, setTitle] = useState(groupName)
  const [about, setAbout] = useState(description ?? '')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const { data: members = [], error: membersError, mutate } = useSWR<GroupMember[]>(`/api/conversations/${encodeURIComponent(conversationId)}/members`, memberFetcher)

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || viewerRole !== 'admin') return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await updateGroupDetailsAction(conversationId, title, about)
      setNotice('Group details saved.')
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Group details could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function inviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || viewerRole !== 'admin') return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await inviteGroupMemberAction(conversationId, email)
      setEmail('')
      setNotice('Invitation sent.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invitation could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  async function removeMember(member: GroupMember) {
    if (busy || !window.confirm(`Remove ${member.name} from this group?`)) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await removeGroupMemberAction(conversationId, member.id)
      await mutate()
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Member could not be removed.')
    } finally {
      setBusy(false)
    }
  }

  async function leaveGroup() {
    if (busy || !window.confirm('Leave this group?')) return
    setBusy(true)
    setError('')
    try {
      await leaveGroupAction(conversationId)
      onLeft()
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'You could not leave this group.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop group-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="dialog-card group-management-dialog" role="dialog" aria-modal="true" aria-labelledby="group-dialog-title">
        <header className="dialog-header">
          <div><p className="inbox-kicker">GROUP SPACE</p><h2 id="group-dialog-title">Group details</h2></div>
          <button className="icon-button" type="button" aria-label="Close group details" onClick={onClose}><X aria-hidden="true" /></button>
        </header>
        <p className="group-member-count"><UsersRound aria-hidden="true" /> {members.length} member{members.length === 1 ? '' : 's'} · {viewerRole === 'admin' ? 'You are an admin' : 'Member'}</p>
        {viewerRole === 'admin' ? (
          <form className="dialog-form group-details-form" onSubmit={saveDetails}>
            <label htmlFor="group-details-name">Group name</label>
            <input id="group-details-name" value={title} onChange={(event) => setTitle(event.target.value)} minLength={2} maxLength={80} required />
            <label htmlFor="group-details-about">Description</label>
            <textarea id="group-details-about" value={about} onChange={(event) => setAbout(event.target.value)} maxLength={280} rows={2} placeholder="What brings this group together?" />
            <button className="solid-button" type="submit" disabled={busy || (title === groupName && about === (description ?? ''))}>Save details</button>
          </form>
        ) : description ? <p className="group-description-copy">{description}</p> : null}
        {viewerRole === 'admin' ? (
          <form className="dialog-form group-invite-form" onSubmit={inviteMember}>
            <label htmlFor="group-invite-email">Invite by email</label>
            <div className="group-invite-row"><input id="group-invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" maxLength={254} placeholder="name@example.com" required /><button className="solid-button" type="submit" disabled={busy}>Invite</button></div>
            <p className="dialog-hint">The recipient can accept or decline from notifications. Their group-invite privacy setting is respected.</p>
          </form>
        ) : null}
        <div className="group-members-section">
          <h3>People</h3>
          {membersError ? <p className="form-error" role="status">Group members could not be loaded.</p> : null}
          <div className="group-member-list">
            {members.map((member) => (
              <div className="group-member-row" key={member.id}>
                <span className="group-member-avatar" aria-hidden="true">{member.image ? <img src={member.image} alt="" /> : member.name.slice(0, 1).toUpperCase()}</span>
                <span className="group-member-name"><strong>{member.id === viewerId ? `${member.name} (you)` : member.name}</strong>{member.role === 'admin' ? <small><ShieldCheck aria-hidden="true" /> Admin</small> : null}</span>
                {viewerRole === 'admin' && member.id !== viewerId && member.role !== 'admin' ? <button className="group-remove-button" type="button" aria-label={`Remove ${member.name}`} onClick={() => void removeMember(member)} disabled={busy}><UserMinus aria-hidden="true" /></button> : null}
              </div>
            ))}
          </div>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {notice ? <p className="settings-notice" role="status">{notice}</p> : null}
        <button className="group-leave-button" type="button" onClick={() => void leaveGroup()} disabled={busy}>Leave group</button>
      </section>
    </div>
  )
}
