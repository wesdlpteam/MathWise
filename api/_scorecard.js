/**
 * Pure arithmetic for the weekly scorecard. No database, no HTTP, no dates
 * beyond what the caller passes in, so every branch is directly testable.
 */

export function median(numbers) {
  const list = (numbers || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return 0;
  const mid = Math.floor(list.length / 2);
  const value = list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
  return Math.round(value * 10) / 10;
}

export function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

// A week with no history has no percentage change to report. Saying "up 100%"
// from a base of zero would overstate a single new chat, so pct is null there
// and the dashboard shows the raw change instead.
export function delta(now, before) {
  const change = Math.round((now - before) * 10) / 10;
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const percentage = before ? Math.round(((now - before) / before) * 1000) / 10 : null;
  return { change, direction, pct: percentage };
}

const COMPLETED = new Set(["solved", "shown"]);

function topLabel(rows, field) {
  const counts = new Map();
  rows.forEach(r => {
    const key = r[field];
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  if (!counts.size) return "None yet";
  return [...counts].sort((l, r) => r[1] - l[1])[0][0];
}

export function scorecard(rows) {
  const list = rows || [];
  const chats = list.length;
  const completed = list.filter(r => COMPLETED.has(r.outcome));
  const rated = list.filter(r => r.rating === "up" || r.rating === "down");
  const cost = list.reduce((sum, r) => sum + (Number(r.cost_usd) || 0), 0);
  return {
    chats,
    devices: new Set(list.map(r => r.device)).size,
    completionRate: pct(completed.length, chats),
    abandonRate: pct(chats - completed.length, chats),
    helpfulRate: pct(rated.filter(r => r.rating === "up").length, rated.length),
    ratedCount: rated.length,
    medianTurns: median(completed.map(r => r.turns)),
    medianMinutes: median(completed.map(r => (Number(r.seconds) || 0) / 60)),
    topTopic: topLabel(list, "topic"),
    topBand: topLabel(list, "band"),
    cost: Math.round(cost * 10000) / 10000
  };
}
