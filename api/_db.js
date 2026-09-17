import { neon } from "@neondatabase/serverless";

let _sql = null;

export function getSql() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql;
}

// Tests inject a fake tagged-template function here.
export function setSqlForTests(fn) { _sql = fn; }
