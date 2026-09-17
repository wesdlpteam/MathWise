-- MathWISE analytics. One row per question a student worked on.
-- Anonymous by construction: device is a random per-browser id, and there is
-- no column for question text, names, classes or images.
--
-- This file shares a Neon instance with the Springboard project's own tables.
-- CREATE TABLE IF NOT EXISTS only. Never add a DROP to this file.
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
);
CREATE INDEX IF NOT EXISTS mw_events_ts_idx ON mw_events (ts);
CREATE INDEX IF NOT EXISTS mw_events_outcome_idx ON mw_events (outcome);
