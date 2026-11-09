import { connection } from "next/server";
import { Pool, types, type PoolClient, type QueryResult } from "pg";

// node-pg returns BIGINT as strings by default, which silently breaks
// every `id === number` comparison. Parse them as integers app-wide.
types.setTypeParser(types.builtins.INT8, (v: string) => parseInt(v, 10));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export type Queryable = { query: (text: string, params?: unknown[]) => Promise<QueryResult> };

/** Run a multi-write flow atomically. Callers pass the transaction client to services. */
export async function withTransaction<T>(fn: (q: PoolClient) => Promise<T>): Promise<T> {
  await connection();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Direct query for Proxy/request-boundary code where connection() is unavailable. */
export async function queryAtRequestBoundary(text: string, params?: unknown[]) {
  return pool.query(text, params);
}

export const db = {
  // Marks the caller as request-time rendering under Cache Components,
  // so DB-backed pages are never statically prerendered.
  query: async (text: string, params?: unknown[]) => {
    await connection();
    return pool.query(text, params);
  },
  connect: async () => {
    await connection();
    return pool.connect();
  },
};
