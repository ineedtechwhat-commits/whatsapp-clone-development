import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

export const users = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const sessions = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId').notNull(),
})

export const accounts = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId').notNull(),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const verifications = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const userProfiles = pgTable('user_profile', {
  userId: text('userId').primaryKey(),
  about: text('about').notNull().default('Available'),
  lastSeenVisibility: text('lastSeenVisibility').notNull().default('everyone'),
  profilePhotoVisibility: text('profilePhotoVisibility').notNull().default('everyone'),
  aboutVisibility: text('aboutVisibility').notNull().default('contacts'),
  statusVisibility: text('statusVisibility').notNull().default('contacts'),
  readReceipts: boolean('readReceipts').notNull().default(true),
  defaultMessageTimer: text('defaultMessageTimer').notNull().default('off'),
  groupInvitePolicy: text('groupInvitePolicy').notNull().default('everyone'),
  callsPrivacy: text('callsPrivacy').notNull().default('everyone'),
  securityNotifications: boolean('securityNotifications').notNull().default(true),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const conversations = pgTable('conversation', {
  id: text('id').primaryKey(),
  createdBy: text('createdBy').notNull(),
  title: text('title'),
  isGroup: boolean('isGroup').notNull().default(false),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const conversationMembers = pgTable(
  'conversation_member',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversationId').notNull(),
    userId: text('userId').notNull(),
    joinedAt: timestamp('joinedAt').notNull().defaultNow(),
    lastReadAt: timestamp('lastReadAt'),
  },
  (table) => [
    unique('conversation_member_conversation_user_unique').on(table.conversationId, table.userId),
    index('conversation_member_user_idx').on(table.userId, table.conversationId),
  ],
)

export const messages = pgTable(
  'message',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversationId').notNull(),
    senderId: text('senderId').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    editedAt: timestamp('editedAt'),
    deletedAt: timestamp('deletedAt'),
    expiresAt: timestamp('expiresAt'),
  },
  (table) => [index('message_conversation_created_idx').on(table.conversationId, table.createdAt)],
)

export const statuses = pgTable(
  'status',
  {
    id: text('id').primaryKey(),
    userId: text('userId').notNull(),
    caption: text('caption').notNull(),
    mediaUrl: text('mediaUrl'),
    mediaPathname: text('mediaPathname'),
    mediaType: text('mediaType'),
    mediaName: text('mediaName'),
    mediaSize: integer('mediaSize'),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    expiresAt: timestamp('expiresAt').notNull(),
  },
  (table) => [index('status_expiration_idx').on(table.expiresAt, table.userId)],
)

export const messageAttachments = pgTable(
  'message_attachment',
  {
    id: text('id').primaryKey(),
    messageId: text('messageId').notNull(),
    conversationId: text('conversationId').notNull(),
    uploadedBy: text('uploadedBy').notNull(),
    pathname: text('pathname').notNull().unique(),
    filename: text('filename').notNull(),
    contentType: text('contentType').notNull(),
    size: integer('size').notNull(),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
  },
  (table) => [
    index('message_attachment_message_idx').on(table.messageId),
    index('message_attachment_conversation_idx').on(table.conversationId),
  ],
)

export const adminControlRecords = pgTable('admin_control_records', {
  id: text('id').primaryKey(),
  recordType: text('record_type').notNull(),
  roleUserId: text('role_user_id').unique(),
  actorUserId: text('actor_user_id'),
  subjectUserId: text('subject_user_id'),
  action: text('action').notNull(),
  status: text('status').notNull().default('active'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})
