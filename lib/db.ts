import { connection } from "next/server";
import { Pool, types } from "pg";

// node-pg returns BIGINT as strings by default, which silently breaks
// every `id === number` comparison. Parse them as integers app-wide.
types.setTypeParser(types.builtins.INT8, (v: string) => parseInt(v, 10));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

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
