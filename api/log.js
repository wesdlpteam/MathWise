import { applyCors, rateLimit } from "./_lib.js";
import { getSql } from "./_db.js";
import { sanitiseEvent, CATEGORIES } from "./_analytics.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  // Students call this one, so there is no passcode. The allow-list bounds
  // what can be stored and this bounds how much.
  if (!rateLimit(req, res, { max: 60, windowMs: 60000, name: "log" })) return;

  const b = req.body || {};
  if (!CATEGORIES.outcome.includes(b.outcome)) {
    return res.status(400).json({ error: "Unknown outcome" });
  }

  const e = sanitiseEvent(b);
  try {
    const sql = getSql();
    await sql`
      INSERT INTO mw_events (device, course, band, topic, outcome, turns, seconds,
                             rating, tokens_in, tokens_out, cost_usd)
      VALUES (${e.device}, ${e.course}, ${e.band}, ${e.topic}, ${e.outcome}, ${e.turns},
              ${e.seconds}, ${e.rating}, ${e.tokens_in}, ${e.tokens_out}, ${e.cost_usd})`;
    return res.status(200).json({ ok: true });
  } catch (err) {
    // Log server side, tell the caller nothing about our internals.
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
