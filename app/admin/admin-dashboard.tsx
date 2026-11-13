'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Activity, AlertTriangle, ArrowLeft, BarChart3, Crown, FileText, Flag, LockKeyhole, MessageSquareText, Search, Shield, Users, X } from 'lucide-react'
import { runAdminToolAction } from '@/app/actions/admin'
import { adminTools, type AdminToolCategory, type AdminToolInput, type AdminToolResult } from '@/lib/admin-tools'

type Overview = { users: number; conversations: number; messages: number; openReports: number; admins: number }

const categories = ['All tools', ...Array.from(new Set(adminTools.map((tool) => tool.category)))] as Array<'All tools' | AdminToolCategory>
const categoryIcons = {
  Overview: BarChart3,
  Users,
  Moderation: Flag,
  Community: MessageSquareText,
  'Platform & security': Shield,
}
const destructiveTools = new Set(['users.revoke-sessions', 'messages.remove', 'reports.dismiss', 'users.suspend', 'users.restore', 'groups.remove-member', 'statuses.remove', 'attachments.remove'])

function formatValue(value: string | number | boolean | null) {
  if (value === null) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

export function AdminDashboard({ initialOverview, initialTheme }: { initialOverview: Overview; initialTheme: 'dark' | 'light' }) {
  const router = useRouter()
  const [category, setCategory] = useState<'All tools' | AdminToolCategory>('All tools')
  const [filter, setFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string>(adminTools[0].id)
  const [query, setQuery] = useState('')
  const [targetId, setTargetId] = useState('')
  const [relatedId, setRelatedId] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [reason, setReason] = useState('')
  const [result, setResult] = useState<AdminToolResult | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const selectedTool = adminTools.find((tool) => tool.id === selectedId) ?? adminTools[0]

  const filteredTools = useMemo(() => {
    const search = filter.trim().toLowerCase()
    return adminTools.filter((tool) => {
      const categoryMatches = category === 'All tools' || tool.category === category
      const searchMatches = !search || `${tool.label} ${tool.description} ${tool.category}`.toLowerCase().includes(search)
      return categoryMatches && searchMatches
    })
  }, [category, filter])

  function selectTool(toolId: string) {
    setSelectedId(toolId)
    setResult(null)
    setError('')
  }

  async function runTool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    if (destructiveTools.has(selectedId) && !window.confirm('Apply this administrative change? The action will be recorded in the audit log.')) return

    const input: AdminToolInput = { query, targetId, relatedId, title, body, reason }
    setPending(true)
    setResult(null)
    setError('')
    try {
      setResult(await runAdminToolAction(selectedId, input))
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The admin tool could not be completed.')
    } finally {
      setPending(false)
    }
  }

  function resetInputs() {
    setQuery('')
    setTargetId('')
    setRelatedId('')
    setTitle('')
    setBody('')
    setReason('')
    setResult(null)
    setError('')
  }

  return (
    <main className="admin-shell" data-theme={initialTheme}>
      <header className="admin-topbar">
        <a className="admin-back-link" href="/" aria-label="Return to messages"><ArrowLeft aria-hidden="true" /><span>Messages</span></a>
        <div className="admin-topbar-brand"><span className="admin-brand-mark"><Crown aria-hidden="true" /></span><span>F.R.I.E.N.D.S <small>CONTROL ROOM</small></span></div>
        <span className="admin-access-pill"><span /> Admin access</span>
      </header>

      <section className="admin-page-heading" aria-labelledby="admin-title">
        <div>
          <p className="admin-eyebrow">PLATFORM OPERATIONS</p>
          <h1 id="admin-title">Admin console</h1>
          <p>Trusted controls for the people and conversations that make up F.R.I.E.N.D.S.</p>
        </div>
        <div className="admin-tools-total"><strong>50</strong><span>available tools</span></div>
      </section>

      <section className="admin-metrics" aria-label="Platform overview">
        <article className="admin-metric-card"><span><Users aria-hidden="true" /></span><div><small>Registered users</small><strong>{initialOverview.users.toLocaleString()}</strong></div></article>
        <article className="admin-metric-card"><span><MessageSquareText aria-hidden="true" /></span><div><small>Conversations</small><strong>{initialOverview.conversations.toLocaleString()}</strong></div></article>
        <article className="admin-metric-card"><span><Activity aria-hidden="true" /></span><div><small>Messages</small><strong>{initialOverview.messages.toLocaleString()}</strong></div></article>
        <article className="admin-metric-card"><span><AlertTriangle aria-hidden="true" /></span><div><small>Open reports</small><strong>{initialOverview.openReports.toLocaleString()}</strong></div></article>
        <article className="admin-metric-card"><span><Crown aria-hidden="true" /></span><div><small>Administrators</small><strong>{initialOverview.admins.toLocaleString()}</strong></div></article>
      </section>

      <section className="admin-workspace" aria-label="Admin tools">
        <div className="admin-catalog">
          <div className="admin-catalog-heading"><div><p className="admin-eyebrow">TOOL LIBRARY</p><h2>Choose a tool</h2></div><span>{filteredTools.length} / 50</span></div>
          <label className="admin-search"><Search aria-hidden="true" /><span className="sr-only">Search admin tools</span><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search tools" /></label>
          <div className="admin-category-list" aria-label="Filter tools by category">
            {categories.map((item) => <button key={item} className={category === item ? 'active' : ''} type="button" aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}
          </div>
          <div className="admin-tool-grid">
            {filteredTools.map((tool) => {
              const Icon = categoryIcons[tool.category]
              return (
                <button key={tool.id} className={`admin-tool-card${selectedId === tool.id ? ' selected' : ''}`} type="button" onClick={() => selectTool(tool.id)} aria-pressed={selectedId === tool.id}>
                  <span className="admin-tool-icon"><Icon aria-hidden="true" /></span>
                  <span className="admin-tool-copy"><strong>{tool.label}</strong><small>{tool.description}</small></span>
                </button>
              )
            })}
            {!filteredTools.length ? <p className="admin-empty">No tools match that search.</p> : null}
          </div>
        </div>

        <aside className="admin-run-panel" aria-labelledby="selected-tool-title">
          <div className="admin-run-heading">
            <div><p className="admin-eyebrow">{selectedTool.category.toUpperCase()}</p><h2 id="selected-tool-title">{selectedTool.label}</h2><p>{selectedTool.description}</p></div>
            <button className="admin-clear-button" type="button" aria-label="Clear tool inputs and result" onClick={resetInputs}><X aria-hidden="true" /></button>
          </div>

          <form className="admin-run-form" onSubmit={runTool}>
            {selectedTool.mode === 'search' ? (
              <label><span>Search by name, email, or ID</span><input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={254} placeholder="Start typing…" /></label>
            ) : null}
            {['target', 'target-reason', 'target-secondary', 'target-title'].includes(selectedTool.mode) ? (
              <label><span>{selectedTool.mode === 'target-title' || selectedId === 'groups.members' || selectedId === 'conversations.details' ? 'Conversation or record ID' : 'Account, message, group, or record ID'}</span><input value={targetId} onChange={(event) => setTargetId(event.target.value)} maxLength={254} placeholder="Paste an ID or account email" required /></label>
            ) : null}
            {selectedTool.mode === 'target-secondary' ? <label><span>Member user ID</span><input value={relatedId} onChange={(event) => setRelatedId(event.target.value)} maxLength={254} placeholder="User ID to remove" required /></label> : null}
            {selectedTool.mode === 'target-title' ? <label><span>New group name</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} minLength={2} placeholder="A clear, respectful name" required /></label> : null}
            {selectedTool.mode === 'target-reason' ? <label><span>Reason for the audit record</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={500} placeholder="Add context for this action" /></label> : null}
            {selectedTool.mode === 'compose' ? <>
              <label><span>Announcement title</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} minLength={2} placeholder="A short headline" required /></label>
              <label><span>Announcement message</span><textarea value={body} onChange={(event) => setBody(event.target.value)} rows={5} maxLength={2000} placeholder="Write a message for the community" required /></label>
            </> : null}
            <button className="admin-run-button" type="submit" disabled={pending}>{pending ? 'Working…' : selectedTool.mode === 'view' ? 'Run report' : selectedTool.mode === 'compose' ? 'Publish announcement' : 'Run tool'}</button>
          </form>

          <div className="admin-result" aria-live="polite" aria-busy={pending}>
            {error ? <p className="admin-result-error" role="alert">{error}</p> : null}
            {pending ? <p className="admin-result-muted">Loading live platform data…</p> : null}
            {result ? <>
              <p className="admin-result-summary">{result.summary}</p>
              {result.records?.length ? (
                <div className="admin-table-wrap"><table className="admin-table"><thead><tr>{Object.keys(result.records[0]).map((key) => <th key={key} scope="col">{key.replace(/([A-Z])/g, ' $1')}</th>)}</tr></thead><tbody>{result.records.map((row, index) => <tr key={String(row.id ?? row.reportId ?? row.userId ?? index)}>{Object.values(row).map((value, cellIndex) => <td key={cellIndex}>{formatValue(value)}</td>)}</tr>)}</tbody></table></div>
              ) : null}
            </> : !pending && !error ? <div className="admin-result-empty"><span><FileText aria-hidden="true" /></span><strong>Ready when you are</strong><p>Run this tool to view current database-backed results.</p></div> : null}
          </div>

          <p className="admin-security-note"><LockKeyhole aria-hidden="true" /> Every tool verifies your admin role on the server. Sensitive changes are added to the audit log.</p>
        </aside>
      </section>
    </main>
  )
}
