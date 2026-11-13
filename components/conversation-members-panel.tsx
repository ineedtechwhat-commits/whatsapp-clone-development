'use client'

import useSWR from 'swr'
import { Crown, UsersRound, X } from 'lucide-react'

type ConversationMember = {
  id: string
  name: string
  image: string | null
  role: 'admin' | 'member'
  presence: 'online' | 'offline' | 'hidden'
  about: string | null
}

const memberFetcher = async (url: string): Promise<ConversationMember[]> => {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) throw new Error('Unable to load group members')
  return response.json()
}

export function ConversationMembersPanel({
  conversationId,
  groupName,
  description,
  onClose,
  onProfileClick,
}: {
  conversationId: string
  groupName: string
  description: string | null
  onClose: () => void
  onProfileClick: (memberId: string) => void
}) {
  const { data: members, error } = useSWR<ConversationMember[]>(
    `/api/conversations/${encodeURIComponent(conversationId)}/members`,
    memberFetcher,
    { refreshInterval: 30_000, revalidateOnFocus: true },
  )
  const onlineMembers = members?.filter((member) => member.presence === 'online') ?? []
  const otherMembers = members?.filter((member) => member.presence !== 'online') ?? []

  function renderMember(member: ConversationMember) {
    const presenceLabel = member.presence === 'online' ? 'Online now' : member.presence === 'hidden' ? 'Presence hidden' : 'Offline'
    const content = (
      <>
        <span className={`member-panel-avatar${member.presence === 'online' ? ' is-online' : ''}`}>
          {member.image ? <img src={member.image} alt="" loading="lazy" /> : member.name.trim().slice(0, 1).toUpperCase() || '?'}
        </span>
        <span className="member-panel-copy">
          <span className="member-panel-name">{member.name}</span>
          <span className="member-panel-presence">{presenceLabel}{member.about ? ` · ${member.about}` : ''}</span>
        </span>
        {member.role === 'admin' ? <span className="member-panel-role"><Crown aria-hidden="true" />Admin</span> : null}
      </>
    )

    return (
      <li key={member.id}>
        <button className="member-panel-person" type="button" onClick={() => onProfileClick(member.id)} aria-label={`View ${member.name}'s profile. ${presenceLabel}${member.role === 'admin' ? ', group admin' : ''}`}>
          {content}
        </button>
      </li>
    )
  }

  return (
    <aside className="conversation-members-panel" id="conversation-member-panel" aria-label={`${groupName} members`}>
      <header className="member-panel-header">
        <div className="member-panel-title"><UsersRound aria-hidden="true" /><span><strong>Members</strong><small>{members ? `${members.length} people` : 'Loading people'}</small></span></div>
        <button className="member-panel-close" type="button" aria-label="Hide members" onClick={onClose}><X aria-hidden="true" /></button>
      </header>
      {description ? <p className="member-panel-description">{description}</p> : null}
      {error ? <p className="member-panel-state" role="status">Group members could not be loaded.</p> : !members ? <p className="member-panel-state" role="status">Loading group members…</p> : (
        <div className="member-panel-sections">
          <section aria-labelledby="online-members-title">
            <h3 id="online-members-title">Online <span>{onlineMembers.length}</span></h3>
            {onlineMembers.length ? <ul>{onlineMembers.map(renderMember)}</ul> : <p className="member-panel-empty">No one is online right now.</p>}
          </section>
          <section aria-labelledby="other-members-title">
            <h3 id="other-members-title">Offline or hidden <span>{otherMembers.length}</span></h3>
            {otherMembers.length ? <ul>{otherMembers.map(renderMember)}</ul> : <p className="member-panel-empty">Everyone is here.</p>}
          </section>
        </div>
      )}
    </aside>
  )
}
