import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

type GlobalPool = typeof globalThis & { chatPool?: Pool }
const globalPool = globalThis as GlobalPool

export const pool =
  globalPool.chatPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })

if (process.env.NODE_ENV !== 'production') globalPool.chatPool = pool

export const db = drizzle(pool, { schema })
