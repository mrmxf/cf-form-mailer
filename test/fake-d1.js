/**
 * A D1Database over node:sqlite running the REAL migrations - so a query that
 * would fail on D1 fails here too. Ported from cloudflare-workers'
 * lib/monitor/test/fakes.ts. Tests only; never bundled.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS = join(import.meta.dirname, "..", "db", "migrations");

class FakeStatement {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }

  bind(...args) {
    for (const a of args) {
      // D1 rejects undefined - so must we, or tests hide the bug
      if (a === undefined) throw new Error(`D1_TYPE_ERROR: undefined bound in ${this.sql.slice(0, 60)}`);
    }
    return new FakeStatement(this.db, this.sql, args);
  }

  async all() {
    const rows = this.db.prepare(this.sql).all(...this.args).map((r) => ({ ...r }));
    return { results: rows, success: true, meta: {} };
  }

  async first() {
    const row = this.db.prepare(this.sql).get(...this.args);
    return row ? { ...row } : null;
  }

  async run() {
    const info = this.db.prepare(this.sql).run(...this.args);
    return { results: [], success: true, meta: { changes: Number(info.changes) } };
  }

  runSync() {
    this.db.prepare(this.sql).run(...this.args);
  }
}

/** A fresh in-memory D1 with every migration applied. */
export function fakeD1() {
  const sqlite = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  const d1 = {
    prepare: (sql) => new FakeStatement(sqlite, sql),
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        for (const s of statements) s.runSync();
        sqlite.exec("COMMIT");
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
      return statements.map(() => ({ success: true }));
    },
  };
  return { d1, sqlite, rows: (sql, ...args) => sqlite.prepare(sql).all(...args).map((r) => ({ ...r })) };
}
