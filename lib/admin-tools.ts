export type AdminToolMode = 'view' | 'search' | 'target' | 'target-reason' | 'target-secondary' | 'target-title' | 'compose'

export const adminTools = [
  { id: 'users.total', category: 'Overview', label: 'Registered users', description: 'Count all accounts in the platform.', mode: 'view' },
  { id: 'users.verified', category: 'Overview', label: 'Verified accounts', description: 'Count accounts with verified email addresses.', mode: 'view' },
  { id: 'users.unverified', category: 'Overview', label: 'Unverified accounts', description: 'Count accounts that still need email verification.', mode: 'view' },
  { id: 'users.new24h', category: 'Overview', label: 'New users · 24 hours', description: 'Review signups from the last 24 hours.', mode: 'view' },
  { id: 'users.new7d', category: 'Overview', label: 'New users · 7 days', description: 'Review signups from the last seven days.', mode: 'view' },
  { id: 'users.new30d', category: 'Overview', label: 'New users · 30 days', description: 'Review signups from the last 30 days.', mode: 'view' },
  { id: 'conversations.total', category: 'Overview', label: 'Total conversations', description: 'Count direct and group conversations.', mode: 'view' },
  { id: 'conversations.direct', category: 'Overview', label: 'Direct conversations', description: 'Count one-to-one conversations.', mode: 'view' },
  { id: 'conversations.groups', category: 'Overview', label: 'Group conversations', description: 'Count group conversations.', mode: 'view' },
  { id: 'messages.24h', category: 'Overview', label: 'Messages · 24 hours', description: 'Count messages sent in the last 24 hours.', mode: 'view' },

  { id: 'users.search', category: 'Users', label: 'Search accounts', description: 'Find an account by name, email, or ID.', mode: 'search' },
  { id: 'users.recent', category: 'Users', label: 'Recent signups', description: 'Inspect the latest account registrations.', mode: 'view' },
  { id: 'users.unverified.list', category: 'Users', label: 'Verification queue', description: 'Review accounts with unverified email.', mode: 'view' },
  { id: 'users.missing-photo', category: 'Users', label: 'Profiles without photos', description: 'Find accounts that have no profile image.', mode: 'view' },
  { id: 'users.missing-about', category: 'Users', label: 'Profiles without a bio', description: 'Find accounts with an empty or default bio.', mode: 'view' },
  { id: 'users.most-conversations', category: 'Users', label: 'Conversation activity', description: 'Rank users by conversation membership count.', mode: 'view' },
  { id: 'users.profile', category: 'Users', label: 'Account profile lookup', description: 'View public profile fields for one account.', mode: 'search' },
  { id: 'users.privacy', category: 'Users', label: 'Privacy preferences', description: 'Inspect saved privacy settings for an account.', mode: 'search' },
  { id: 'users.sessions', category: 'Users', label: 'Account sessions', description: 'Inspect active session metadata without session tokens.', mode: 'search' },
  { id: 'users.revoke-sessions', category: 'Users', label: 'Revoke account sessions', description: 'Sign an account out of all active sessions.', mode: 'target' },

  { id: 'reports.open', category: 'Moderation', label: 'Open report queue', description: 'Review unresolved message and account reports.', mode: 'view' },
  { id: 'reports.messages', category: 'Moderation', label: 'Reported messages', description: 'Inspect reported message text and reporter context.', mode: 'view' },
  { id: 'reports.users', category: 'Moderation', label: 'Reported accounts', description: 'Inspect user reports and the reported profile.', mode: 'view' },
  { id: 'reports.resolved', category: 'Moderation', label: 'Resolved reports', description: 'Review recently resolved or dismissed reports.', mode: 'view' },
  { id: 'messages.expired', category: 'Moderation', label: 'Expired messages', description: 'Find messages past their configured expiry.', mode: 'view' },
  { id: 'messages.remove', category: 'Moderation', label: 'Remove reported message', description: 'Remove a message with an open report and record the action.', mode: 'target-reason' },
  { id: 'messages.restore', category: 'Moderation', label: 'Restore removed message', description: 'Restore a message removed by an admin action.', mode: 'target' },
  { id: 'reports.dismiss', category: 'Moderation', label: 'Dismiss report', description: 'Close a report that does not require action.', mode: 'target' },
  { id: 'users.suspend', category: 'Moderation', label: 'Suspend or ban account', description: 'Apply a persistent restriction and revoke the account’s active sessions.', mode: 'target-reason' },
  { id: 'users.restore', category: 'Moderation', label: 'Restore account access', description: 'Lift the latest active account restriction.', mode: 'target' },

  { id: 'groups.directory', category: 'Community', label: 'Group directory', description: 'Review group names, member counts, and recent activity.', mode: 'view' },
  { id: 'conversations.direct.list', category: 'Community', label: 'Direct conversation inventory', description: 'View direct conversation metadata without message content.', mode: 'view' },
  { id: 'groups.largest', category: 'Community', label: 'Largest groups', description: 'Rank groups by current member count.', mode: 'view' },
  { id: 'groups.empty', category: 'Community', label: 'Groups without messages', description: 'Find groups that have not started a conversation.', mode: 'view' },
  { id: 'groups.dormant', category: 'Community', label: 'Dormant groups', description: 'Find groups with no recent conversation activity.', mode: 'view' },
  { id: 'groups.members', category: 'Community', label: 'Group member lookup', description: 'List members for a group conversation ID.', mode: 'target' },
  { id: 'groups.rename', category: 'Community', label: 'Rename a group', description: 'Update the title of an existing group.', mode: 'target-title' },
  { id: 'groups.remove-member', category: 'Community', label: 'Remove group member', description: 'Remove a member using a group ID and user ID.', mode: 'target-secondary' },
  { id: 'conversations.details', category: 'Community', label: 'Conversation metadata', description: 'Inspect a conversation’s membership and message counts.', mode: 'target' },
  { id: 'groups.newest', category: 'Community', label: 'Recently updated groups', description: 'Review groups ordered by latest activity.', mode: 'view' },

  { id: 'statuses.active', category: 'Platform & security', label: 'Active status updates', description: 'Count status posts that have not expired.', mode: 'view' },
  { id: 'statuses.expiring', category: 'Platform & security', label: 'Expiring status updates', description: 'Review statuses due to expire in the next two hours.', mode: 'view' },
  { id: 'statuses.remove', category: 'Platform & security', label: 'Remove status update', description: 'Remove a status update by its ID.', mode: 'target' },
  { id: 'attachments.list', category: 'Platform & security', label: 'Attachment inventory', description: 'Review attachment metadata, not private file contents.', mode: 'view' },
  { id: 'attachments.largest', category: 'Platform & security', label: 'Largest attachments', description: 'Find the largest stored message attachments.', mode: 'view' },
  { id: 'attachments.remove', category: 'Platform & security', label: 'Remove attachment', description: 'Remove an attachment record and its stored blob.', mode: 'target' },
  { id: 'sessions.active', category: 'Platform & security', label: 'Active session count', description: 'Count unexpired sessions without exposing tokens.', mode: 'view' },
  { id: 'audit.recent', category: 'Platform & security', label: 'Admin audit log', description: 'Review the latest recorded administrator actions.', mode: 'view' },
  { id: 'roles.admins', category: 'Platform & security', label: 'Administrator roster', description: 'Review active, database-backed admin assignments.', mode: 'view' },
  { id: 'announcements.publish', category: 'Platform & security', label: 'Publish announcement', description: 'Post an announcement to the signed-in app workspace.', mode: 'compose' },
] as const

export type AdminToolId = (typeof adminTools)[number]['id']
export type AdminToolCategory = (typeof adminTools)[number]['category']
export type AdminToolInput = {
  query?: string
  targetId?: string
  relatedId?: string
  title?: string
  body?: string
  reason?: string
}
export type AdminToolResult = {
  summary: string
  records?: Array<Record<string, string | number | boolean | null>>
}
