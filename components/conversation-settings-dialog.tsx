'use client'

import { useState } from 'react'
import { AlertTriangle, Settings2, Trash2, X } from 'lucide-react'

type ConfirmAction = 'clear' | 'delete' | null

export function ConversationSettingsDialog({
  conversationName,
  isGroup,
  onClose,
  onClear,
  onDelete,
  onManageGroup,
}: {
  conversationName: string
  isGroup: boolean
  onClose: () => void
  onClear: () => Promise<void>
  onDelete: () => Promise<void>
  onManageGroup: () => void
}) {
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function confirm() {
    if (!confirmAction || busy) return
    setBusy(true)
    setError('')
    try {
      if (confirmAction === 'clear') await onClear()
      else await onDelete()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This conversation could not be updated.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section className="dialog-card conversation-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="conversation-settings-title">
        <header className="dialog-header">
          <div>
            <p className="inbox-kicker">CONVERSATION</p>
            <h2 id="conversation-settings-title">{confirmAction ? confirmAction === 'clear' ? 'Clear conversation?' : 'Delete conversation?' : conversationName}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close conversation settings" onClick={onClose} disabled={busy}><X aria-hidden="true" /></button>
        </header>

        {confirmAction ? (
          <div className="conversation-confirmation">
            <span className="conversation-warning-icon"><AlertTriangle aria-hidden="true" /></span>
            <p>{confirmAction === 'clear'
              ? 'This permanently deletes every message and attachment for everyone in this conversation. This cannot be undone.'
              : 'This removes the conversation from your chat list. The other participant keeps their conversation and message history.'}</p>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <div className="conversation-confirm-actions">
              <button className="text-action" type="button" onClick={() => { setConfirmAction(null); setError('') }} disabled={busy}>Cancel</button>
              <button className="conversation-danger-button" type="button" onClick={() => void confirm()} disabled={busy}>
                {busy ? 'Working…' : confirmAction === 'clear' ? 'Delete for everyone' : 'Delete for me'}
              </button>
            </div>
          </div>
        ) : (
          <div className="conversation-settings-actions">
            {isGroup ? <>
              <button className="conversation-setting-row" type="button" onClick={onManageGroup}>
                <span className="conversation-setting-icon"><Settings2 aria-hidden="true" /></span>
                <span><strong>Manage group</strong><small>Update details, members, or leave the group</small></span>
              </button>
              <div className="conversation-setting-divider" />
            </> : null}
            <button className="conversation-setting-row conversation-setting-danger" type="button" onClick={() => setConfirmAction('clear')}>
              <span className="conversation-setting-icon"><Trash2 aria-hidden="true" /></span>
              <span><strong>Clear conversation for everyone</strong><small>Delete all messages and attachments for every participant</small></span>
            </button>
            {!isGroup ? <button className="conversation-setting-row conversation-setting-danger" type="button" onClick={() => setConfirmAction('delete')}>
              <span className="conversation-setting-icon"><X aria-hidden="true" /></span>
              <span><strong>Delete conversation for me</strong><small>Remove it from your chat list; the other person keeps their history</small></span>
            </button> : null}
          </div>
        )}
      </section>
    </div>
  )
}
