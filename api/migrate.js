import { applyCors, requireAdmin, rateLimit } from "./_lib.js";
import { getSql } from "./_db.js";

/**
 * Creates the mw_events table, once, from inside the deployment.
 *
 * The database password is stored write-only in Vercel and cannot be read back,
 * which is correct of it, so there is no way to run db/schema.sql from a laptop.
 * This route does the same job from the one place that does hold the credential.
 *
 * Safe to call repeatedly: every statement is IF NOT EXISTS, so a second call
 * changes nothing. It never drops, alters or deletes anything, which matters
 * because this database is shared with the Springboard project.
 *
 * Admin password required, so a passer-by cannot poke it.
 */
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;
  if (!rateLimit(req, res, { max: 5, windowMs: 60000, name: "migrate" })) return;

  try {
    const sql = getSql();
    // Kept in step with db/schema.sql by hand. Three statements, run in order,
    // because the driver sends one statement per call.
    await sql`
      CREATE TABLE IF NOT EXISTS mw_events (
        id          SERIAL PRIMARY KEY,
        ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
        device      TEXT NOT NULL,
        course      TEXT,
        band        TEXT,
        topic       TEXT,
        outcome     TEXT NOT NULL,
        turns       INTEGER,
        seconds     INTEGER,
        rating      TEXT,
        tokens_in   INTEGER,
        tokens_out  INTEGER,
        cost_usd    NUMERIC(10,6)
      )`;
    await sql`CREATE INDEX IF NOT EXISTS mw_events_ts_idx ON mw_events (ts)`;
    await sql`CREATE INDEX IF NOT EXISTS mw_events_outcome_idx ON mw_events (outcome)`;

    const rows = await sql`SELECT COUNT(*)::int AS n FROM mw_events`;
    return res.status(200).json({ ok: true, table: "mw_events", rows: rows[0]?.n ?? 0 });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
