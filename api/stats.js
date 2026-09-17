import { applyCors, requireAdmin, rateLimit } from "./_lib.js";
import { getSql } from "./_db.js";
import { safeCounts } from "./_analytics.js";
import { scorecard, delta } from "./_scorecard.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdmin(req, res)) return;
  // Ten aggregate queries per call, so a reloading dashboard cannot hammer Neon.
  if (!rateLimit(req, res, { max: 30, windowMs: 60000, name: "stats" })) return;

  try {
    const sql = getSql();
    const [totals, byDay, byBand, byCourse, byTopic, ratings,
           thisWeekRows, lastWeekRows, costByDay, costByMonth] = await Promise.all([
      sql`SELECT outcome, COUNT(*)::int AS n FROM mw_events GROUP BY outcome ORDER BY n DESC`,
      sql`SELECT to_char(ts::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS n
          FROM mw_events WHERE ts > now() - interval '90 days'
          GROUP BY ts::date ORDER BY ts::date`,
      sql`SELECT band, COUNT(*)::int AS n FROM mw_events
          WHERE band IS NOT NULL GROUP BY band ORDER BY n DESC`,
      sql`SELECT course, COUNT(*)::int AS n FROM mw_events
          WHERE course IS NOT NULL GROUP BY course ORDER BY n DESC LIMIT 20`,
      sql`SELECT topic, COUNT(*)::int AS n FROM mw_events
          WHERE topic IS NOT NULL GROUP BY topic ORDER BY n DESC LIMIT 10`,
      sql`SELECT rating, COUNT(*)::int AS n FROM mw_events
          WHERE rating IS NOT NULL GROUP BY rating ORDER BY n DESC`,
      sql`SELECT device, outcome, turns, seconds, rating, topic, band, cost_usd
          FROM mw_events WHERE ts > now() - interval '7 days'`,
      sql`SELECT device, outcome, turns, seconds, rating, topic, band, cost_usd
          FROM mw_events WHERE ts > now() - interval '14 days' AND ts <= now() - interval '7 days'`,
      sql`SELECT to_char(ts::date, 'YYYY-MM-DD') AS period, SUM(cost_usd)::float AS total
          FROM mw_events WHERE ts > now() - interval '30 days'
          GROUP BY ts::date ORDER BY ts::date`,
      sql`SELECT to_char(ts, 'YYYY-MM') AS period, SUM(cost_usd)::float AS total
          FROM mw_events GROUP BY to_char(ts, 'YYYY-MM') ORDER BY period`,
    ]);

    const thisWeek = scorecard(thisWeekRows);
    const lastWeek = scorecard(lastWeekRows);
    const changes = {};
    ["chats", "devices", "completionRate", "abandonRate", "helpfulRate",
     "medianTurns", "medianMinutes", "cost"].forEach(key => {
      changes[key] = delta(thisWeek[key], lastWeek[key]);
    });

    return res.status(200).json({
      totals: safeCounts(totals, "outcome"),
      byDay: byDay.map(r => ({ day: r.day, n: Number(r.n) || 0 })),
      byBand: safeCounts(byBand, "band"),
      byCourse: safeCounts(byCourse, "course"),
      byTopic: safeCounts(byTopic, "topic"),
      ratings: safeCounts(ratings, "rating"),
      scorecard: { thisWeek, lastWeek, changes },
      cost: {
        byDay: costByDay.map(r => ({ period: r.period, total: Number(r.total) || 0 })),
        byMonth: costByMonth.map(r => ({ period: r.period, total: Number(r.total) || 0 })),
        thisWeek: thisWeek.cost,
        lastWeek: lastWeek.cost
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
