import { applyCors, requireStudent, rateLimit } from "./_lib.js";
import { responseDeadline } from "./_deadline.js";

/**
 * The tutoring proxy: the browser asks this, and this asks Anthropic.
 *
 * The whole point is that the API key lives here, in the Vercel project's
 * environment, and never reaches a student's browser. Before this existed every
 * user had to bring their own key, which made the app unshareable.
 *
 * That moves the spending risk onto whoever owns the key, so every knob a caller
 * could turn to run up a bill is clamped below. CORS is not a defence here: it
 * only restrains browsers on other pages, and a plain curl call carries no
 * Origin at all. The real limits are the rate limit, the clamps in this file,
 * and a spend cap set on the Anthropic console, which is the only hard stop.
 */

// The model is chosen here, not by the caller. A caller who could name the model
// could name the most expensive one.
const MODEL = "claude-sonnet-4-6";

// The app's own largest legitimate request is 4000 tokens (a full solution).
const MAX_TOKENS_CEILING = 4000;

// A long Socratic conversation genuinely grows, and the app resends the whole
// history every turn, so this is deliberately far above any real session. It
// exists to stop a caller pasting thousands of messages into one request, not
// to put a ceiling on how long a student can work at a problem.
const MAX_MESSAGES = 400;

// Roughly 4MB of JSON, which is about where Vercel refuses a body anyway; this
// returns a clear message instead of an opaque platform error. The app shrinks
// every photo in the browser before sending, so a real request lands nowhere
// near this and there is no size limit on what a student can photograph.
const MAX_BODY_CHARS = 4_000_000;

// Rate limiting counts per internet address, and a whole school usually shares
// one. A class of thirty working at once is a perfectly normal burst from a
// single address, so this has to be far above one person's pace or it would
// start refusing students mid-lesson. It is here to stop a script in a loop,
// which looks nothing like a classroom.
const REQUESTS_PER_MINUTE = 600;

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  // Open by default, exactly like Springboard: set STUDENT_PASSCODE on the
  // project to require one, leave it unset to let anyone with the link use it.
  if (!requireStudent(req, res)) return;
  if (!rateLimit(req, res, { max: REQUESTS_PER_MINUTE, windowMs: 60000, name: "claude" })) return;

  const body = req.body || {};
  const { system, messages, max_tokens } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "No messages provided" });
  }
  if (messages.length > MAX_MESSAGES) {
    return res.status(400).json({ error: "Too many messages" });
  }
  let size = 0;
  try {
    size = JSON.stringify(body).length;
  } catch (e) {
    return res.status(400).json({ error: "Request could not be read" });
  }
  if (size > MAX_BODY_CHARS) {
    return res.status(413).json({ error: "That photo is too large. Take it again at a smaller size." });
  }

  const payload = { model: MODEL, messages };
  if (system !== undefined) payload.system = system;
  const n = Number(max_tokens);
  payload.max_tokens = Number.isFinite(n)
    ? Math.min(Math.max(Math.trunc(n), 1), MAX_TOKENS_CEILING)
    : 1000;

  const deadline = responseDeadline(req, res);
  try {
    const r = await deadline.wait(fetch("https://api.anthropic.com/v1/messages", {
      signal: deadline.signal,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(payload)
    }));
    const data = await deadline.wait(r.json());
    if (!r.ok || data.error) {
      // Anthropic's own message can name the account or the key, so it is logged
      // here and never returned. A 401 upstream means our key is wrong, which is
      // our problem to fix, not something the student can act on.
      console.error("upstream error", r.status, data && data.error);
      return res.status(502).json({ error: "MathWISE could not be reached. Try again in a moment." });
    }
    return res.status(200).json(data);
  } catch (err) {
    console.error(err);
    const timedOut = err && err.name === "AbortError";
    return res.status(timedOut ? 504 : 500).json({
      error: timedOut ? "That took too long. Try again." : "Server error"
    });
  } finally {
    deadline.close();
  }
}
