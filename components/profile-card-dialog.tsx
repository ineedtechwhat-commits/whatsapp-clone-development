'use client'

import { useEffect } from 'react'
import { MessageCircle, X } from 'lucide-react'
import type { Contact } from '@/lib/chat-types'

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'
}

export function ProfileCardDialog({ person, onClose, onMessage }: { person: Contact; onClose: () => void; onMessage?: () => void }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="dialog-backdrop profile-card-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="profile-card-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-card-name">
        <button className="profile-card-close icon-button" type="button" aria-label="Close profile card" onClick={onClose}><X aria-hidden="true" /></button>
        <div className="profile-dialog-cover" style={person.bannerImage ? { backgroundImage: `url("${person.bannerImage}")` } : undefined}>
          {!person.bannerImage ? <span>F.R.I.E.N.D.S</span> : null}
        </div>
        <div className="profile-dialog-body">
          <div className={`profile-dialog-avatar avatar-decoration-${person.avatarDecoration}`}>
            {person.image ? <img src={person.image} alt={`${person.name}'s profile`} referrerPolicy="no-referrer" /> : <span aria-hidden="true">{initials(person.name)}</span>}
          </div>
          <div className="profile-dialog-identity">
            <span className="profile-dialog-role">{person.isAdmin ? 'Community creator' : 'Community member'}</span>
            <h2 id="profile-card-name">{person.name}</h2>
            <p>@{person.username}</p>
          </div>
          <div className="profile-dialog-about"><span>ABOUT</span><p>{person.about || 'No about information shared.'}</p></div>
          <div className="profile-dialog-meta"><span>Member since</span><strong>{new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(person.createdAt))}</strong></div>
          {onMessage ? <button className="solid-button profile-dialog-message" type="button" onClick={onMessage}><MessageCircle aria-hidden="true" />Message</button> : <button className="settings-secondary-button profile-dialog-message" type="button" onClick={onClose}>Close profile</button>}
        </div>
      </section>
    </div>
  )
}
