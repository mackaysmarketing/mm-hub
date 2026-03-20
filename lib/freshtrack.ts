import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.FRESHTRACK_DATABASE_URL,
  max: 3,
  ssl: { rejectUnauthorized: false },
  idleTimeoutMillis: 10_000,
});

/**
 * Execute a read-only query against the FreshTrack RDS database.
 * Only used by the sync cron route — never exposed to client code.
 */
export async function queryFreshTrack<T extends Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const client = await pool.connect();
  try {
    const result = await client.query<T>(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}
