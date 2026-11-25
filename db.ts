import { Pool, PoolClient } from "pg";
import { env } from "./env";

export const pool = new Pool({ connectionString: env.DATABASE_URL, max: 20, idleTimeoutMillis: 30_000 });

/** Run fn in a transaction; commits on success, rolls back on throw. */
export async function withTransaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
