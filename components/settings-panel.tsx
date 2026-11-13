'use client'

import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowDownToLine,
  BellRing,
  Check,
  CircleHelp,
  Crown,
  ImagePlus,
  LockKeyhole,
  LogOut,
  MessageCircle,
  Moon,
  ShieldCheck,
  Sun,
  UserRound,
  X,
} from 'lucide-react'
import { deleteOwnAccountAction, discardMediaUploadsAction, updatePreferencesAction, updateProfileAction, updateProfilePhotoAction } from '@/app/actions/chat'
import { upload } from '@vercel/blob/client'
import { MAX_PROFILE_PHOTO_BYTES, mediaUrl, PROFILE_PHOTO_TYPES } from '@/lib/media'
import type { ChatPreferences, ChatUser, MessageTimer, Visibility } from '@/lib/chat-types'

type SettingsTab = 'profile' | 'account' | 'privacy' | 'chats' | 'help'

const settingsTabs: Array<{ id: SettingsTab; label: string; icon: typeof UserRound }> = [
  { id: 'profile', label: 'Profile', icon: UserRound },
  { id: 'account', label: 'Account', icon: ShieldCheck },
  { id: 'privacy', label: 'Privacy', icon: LockKeyhole },
  { id: 'chats', label: 'Chats', icon: MessageCircle },
  { id: 'help', label: 'Help', icon: CircleHelp },
]

const visibilityOptions: Array<{ value: Visibility; label: string }> = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'contacts', label: 'My contacts' },
  { value: 'nobody', label: 'Nobody' },
]

const timerOptions: Array<{ value: MessageTimer; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '90d', label: '90 days' },
]

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'
}

function SettingsSelect({
  id,
  label,
  value,
  options,
  onChange,
  description,
}: {
  id: string
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
  description?: string
}) {
  return (
    <label className="settings-control" htmlFor={id}>
      <span className="settings-control-copy"><strong>{label}</strong>{description ? <span>{description}</span> : null}</span>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

function SettingsToggle({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="settings-toggle-row" htmlFor={id}>
      <span><strong>{label}</strong><span>{description}</span></span>
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

export function SettingsPanel({
  user,
  initialPreferences,
  initialTab = 'profile',
  theme,
  onClose,
  onThemeToggle,
  onSignOut,
  onAccountDeleted,
}: {
  user: ChatUser
  initialPreferences: ChatPreferences
  initialTab?: SettingsTab
  theme: 'dark' | 'light'
  onClose: () => void
  onThemeToggle: () => void
  onSignOut: () => void
  onAccountDeleted: () => void
}) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)
  const [name, setName] = useState(user.name)
  const [about, setAbout] = useState(user.about)
  const [profileImage, setProfileImage] = useState(user.image)
  const [preferences, setPreferences] = useState<ChatPreferences>(initialPreferences)
  const [pending, setPending] = useState(false)
  const [photoPending, setPhotoPending] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [deleteConfirmation, setDeleteConfirmation] = useState('')

  function updatePreference<Key extends keyof ChatPreferences>(key: Key, value: ChatPreferences[Key]) {
    setPreferences((current) => ({ ...current, [key]: value }))
    setNotice('')
    setError('')
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setNotice('')
    setError('')
    try {
      await updateProfileAction(name, about)
      setNotice('Your profile is up to date.')
      router.refresh()
    } catch {
      setError('Your profile could not be saved. Check the fields and try again.')
    } finally {
      setPending(false)
    }
  }

  async function changeProfilePhoto(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return

    if (!PROFILE_PHOTO_TYPES.includes(file.type as typeof PROFILE_PHOTO_TYPES[number]) || file.size > MAX_PROFILE_PHOTO_BYTES) {
      setError('Choose a JPG, PNG, WebP, or GIF image up to 5 MB.')
      setNotice('')
      return
    }

    setPhotoPending(true)
    setError('')
    setNotice('')
    let uploadedPathname = ''
    try {
      const blob = await upload(
        `users/${user.id}/profile/${crypto.randomUUID()}`,
        file,
        {
          access: 'private',
          handleUploadUrl: '/api/media/upload',
          clientPayload: JSON.stringify({ purpose: 'profile' }),
          contentType: file.type,
        },
      )
      uploadedPathname = blob.pathname
      await updateProfilePhotoAction(uploadedPathname)
      setProfileImage(mediaUrl(uploadedPathname))
      setNotice('Your profile photo has been updated.')
      router.refresh()
    } catch {
      if (uploadedPathname) await discardMediaUploadsAction([uploadedPathname]).catch(() => undefined)
      setError('Your profile photo could not be updated. Please try again.')
    } finally {
      setPhotoPending(false)
    }
  }

  async function savePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setNotice('')
    setError('')
    try {
      await updatePreferencesAction(preferences)
      setNotice('Your settings have been saved.')
      router.refresh()
    } catch {
      setError('Your settings could not be saved. Please try again.')
    } finally {
      setPending(false)
    }
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (deleteConfirmation !== 'DELETE' || pending) return
    setPending(true)
    setError('')
    try {
      await deleteOwnAccountAction(deleteConfirmation)
      onAccountDeleted()
    } catch {
      setError('Your account could not be removed. Please try again.')
      setPending(false)
    }
  }

  return (
    <div className="dialog-backdrop settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="dialog-card settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-header">
          <div><p className="inbox-kicker">F.R.I.E.N.D.S</p><h2 id="settings-title">Settings</h2></div>
          <button className="icon-button" type="button" aria-label="Close settings" onClick={onClose}><X aria-hidden="true" /></button>
        </header>

        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings sections" role="tablist" aria-orientation="vertical">
            {settingsTabs.map(({ id, label, icon: Icon }) => (
              <button
                className={`settings-nav-item${activeTab === id ? ' active' : ''}`}
                id={`settings-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                aria-controls={`settings-panel-${id}`}
                key={id}
                onClick={() => { setActiveTab(id); setNotice(''); setError('') }}
              >
                <Icon aria-hidden="true" /><span>{label}</span>
              </button>
            ))}
            <div className="settings-nav-bottom">
              <button className="settings-nav-item" type="button" onClick={onSignOut}><LogOut aria-hidden="true" /><span>Sign out</span></button>
            </div>
          </nav>

          <div className="settings-content" role="tabpanel" id={`settings-panel-${activeTab}`} aria-labelledby={`settings-tab-${activeTab}`}>
            {activeTab === 'profile' ? (
              <form className="settings-form" onSubmit={saveProfile}>
                <div className="settings-section-heading"><p className="inbox-kicker">YOUR DETAILS</p><h3>Profile</h3><p>Choose how you appear to people you chat with.</p></div>
                <div className="settings-profile-identity">
                  <span className="settings-avatar" aria-hidden="true">{profileImage ? <img src={profileImage} alt="" referrerPolicy="no-referrer" /> : initials(name)}</span>
                  <div className="settings-profile-copy">
                    <strong className="settings-name-line">{name || user.name}{user.isAdmin ? <span className="admin-identity-badge"><Crown aria-hidden="true" /> ADMIN</span> : null}</strong>
                    <small>{user.isAdmin ? 'Verified F.R.I.E.N.D.S creator' : profileImage ? 'Current profile photo' : 'Add a photo to your profile'}</small>
                    <label className="settings-photo-button">
                      <ImagePlus aria-hidden="true" />
                      <span>{photoPending ? 'Uploading…' : 'Change photo'}</span>
                      <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif" aria-label="Choose a profile photo" aria-describedby="settings-profile-photo-help" onChange={changeProfilePhoto} disabled={pending || photoPending} />
                    </label>
                  </div>
                </div>
                <p className="settings-photo-help" id="settings-profile-photo-help">JPG, PNG, WebP, or GIF. Maximum file size: 5 MB.</p>
                <label className="settings-input" htmlFor="settings-name"><span>Name</span><input id="settings-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required /></label>
                <label className="settings-input" htmlFor="settings-about"><span>About</span>{user.isAdmin ? <textarea id="settings-about" value={about} onChange={(event) => setAbout(event.target.value)} rows={4} required /> : <input id="settings-about" value={about} onChange={(event) => setAbout(event.target.value)} maxLength={120} required />}</label>
                {user.isAdmin ? <small className="settings-admin-note">Creator accounts are not subject to the standard bio character limit.</small> : null}
                <div className="settings-readonly"><span>Email</span><strong>{user.email}</strong><small>{user.emailVerified ? 'Verified email' : 'Email verification required'}</small></div>
                {error ? <p className="settings-error" role="alert">{error}</p> : null}
                {notice ? <p className="settings-notice" role="status">{notice}</p> : null}
                <button className="solid-button settings-submit" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save profile'}</button>
              </form>
            ) : null}

            {activeTab === 'account' ? (
              <div className="settings-form">
                <div className="settings-section-heading"><p className="inbox-kicker">ACCOUNT</p><h3>Account</h3><p>Keep your account protected and take a copy of your information.</p></div>
                <div className="settings-readonly"><span>Email address</span><strong>{user.email}</strong><small>{user.emailVerified ? 'Verified' : 'Not verified'}</small></div>
                <form onSubmit={savePreferences}>
                  <SettingsToggle id="security-notifications" label="Security notifications" description="Keep email alerts enabled for important account changes." checked={preferences.securityNotifications} onChange={(value) => updatePreference('securityNotifications', value)} />
                  <button className="solid-button settings-submit" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save account settings'}</button>
                </form>
                <a className="settings-action-row" href="/api/account/export"><span className="settings-action-icon"><ArrowDownToLine aria-hidden="true" /></span><span><strong>Request account info</strong><small>Download a copy of your profile, chats, and statuses.</small></span><span className="settings-chevron" aria-hidden="true">›</span></a>
                <details className="settings-help-card"><summary>How to delete my account</summary><p>Account removal permanently deletes your profile and sign-in credentials. Your messages are removed from private chats; messages from shared conversations are removed from your account before the account is deleted.</p>
                  <form className="settings-delete-form" onSubmit={deleteAccount}>
                    <label className="settings-input" htmlFor="delete-account-confirmation"><span>Type DELETE to confirm</span><input id="delete-account-confirmation" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" /></label>
                    <button className="danger-button" type="submit" disabled={pending || deleteConfirmation !== 'DELETE'}>{pending ? 'Removing…' : 'Delete my account'}</button>
                  </form>
                </details>
                {error ? <p className="settings-error" role="alert">{error}</p> : null}
                {notice ? <p className="settings-notice" role="status">{notice}</p> : null}
              </div>
            ) : null}

            {activeTab === 'privacy' ? (
              <form className="settings-form" onSubmit={savePreferences}>
                <div className="settings-section-heading"><p className="inbox-kicker">WHO CAN SEE</p><h3>Privacy</h3><p>Control the personal details and updates people can see.</p></div>
                <SettingsSelect id="privacy-last-seen" label="Last seen and online" value={preferences.lastSeenVisibility} options={visibilityOptions} onChange={(value) => updatePreference('lastSeenVisibility', value as Visibility)} />
                <SettingsSelect id="privacy-photo" label="Profile picture" value={preferences.profilePhotoVisibility} options={visibilityOptions} onChange={(value) => updatePreference('profilePhotoVisibility', value as Visibility)} />
                <SettingsSelect id="privacy-about" label="About" value={preferences.aboutVisibility} options={visibilityOptions} onChange={(value) => updatePreference('aboutVisibility', value as Visibility)} />
                <SettingsSelect id="privacy-status" label="Status" value={preferences.statusVisibility} options={visibilityOptions} onChange={(value) => updatePreference('statusVisibility', value as Visibility)} />
                <SettingsToggle id="privacy-read-receipts" label="Read receipts" description="Turn off read receipts for one-to-one chats. Group receipts remain visible." checked={preferences.readReceipts} onChange={(value) => updatePreference('readReceipts', value)} />
                <SettingsSelect id="privacy-groups" label="Groups" value={preferences.groupInvitePolicy} options={visibilityOptions} onChange={(value) => updatePreference('groupInvitePolicy', value as Visibility)} />
                <SettingsSelect id="privacy-calls" label="Calls" value={preferences.callsPrivacy} options={visibilityOptions} onChange={(value) => updatePreference('callsPrivacy', value as Visibility)} description="Saved for when voice and video calling is available." />
                {error ? <p className="settings-error" role="alert">{error}</p> : null}
                {notice ? <p className="settings-notice" role="status">{notice}</p> : null}
                <button className="solid-button settings-submit" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save privacy settings'}</button>
              </form>
            ) : null}

            {activeTab === 'chats' ? (
              <form className="settings-form" onSubmit={savePreferences}>
                <div className="settings-section-heading"><p className="inbox-kicker">CHAT PREFERENCES</p><h3>Chats</h3><p>Set the appearance and default disappearing-message timer.</p></div>
                <div className="settings-theme-row"><span className="settings-action-icon">{theme === 'dark' ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}<span><strong>Theme</strong><small>Choose a comfortable look for your chats.</small></span></span><button className="settings-secondary-button" type="button" onClick={onThemeToggle}>Use {theme === 'dark' ? 'light' : 'dark'} theme</button></div>
                <SettingsSelect id="privacy-message-timer" label="Default message timer" value={preferences.defaultMessageTimer} options={timerOptions} onChange={(value) => updatePreference('defaultMessageTimer', value as MessageTimer)} description="New messages you send will disappear after this time." />
                {error ? <p className="settings-error" role="alert">{error}</p> : null}
                {notice ? <p className="settings-notice" role="status">{notice}</p> : null}
                <button className="solid-button settings-submit" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save chat settings'}</button>
              </form>
            ) : null}

            {activeTab === 'help' ? (
              <div className="settings-form">
                <div className="settings-section-heading"><p className="inbox-kicker">HERE TO HELP</p><h3>Help</h3><p>Useful account information for this F.R.I.E.N.D.S preview.</p></div>
                <div className="settings-help-card"><strong>Email verification</strong><p>New email accounts use a one-time code delivered to your inbox. If it does not arrive, check spam and try sending a new code.</p></div>
                <div className="settings-help-card"><strong>Account information</strong><p>Download a JSON copy of your profile, conversations, and statuses from Account settings.</p></div>
                <div className="settings-help-card"><strong>Voice and video calls</strong><p>Calling is not available in this preview yet. Group chats, direct messages, status updates, emoji, and account privacy controls are available.</p></div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}
