import "dotenv/config";
import pg from "pg";
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 15,
});
pool.on("error", (error) =>
  console.error("Idle PostgreSQL connection error", error.message),
);
export type Db = pg.PoolClient;
export async function transaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const result = await fn(db);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      if (
        attempt < 2 &&
        ["40001", "40P01"].includes((error as { code?: string }).code ?? "")
      ) {
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
        continue;
      }
      throw error;
    } finally {
      db.release();
    }
  }
}
