/**
 * Guards on the GENERATED code in db/gen.
 *
 * sqlc-gen-ts-d1 slices query text by byte offset, so one multi-byte character
 * (a © in a comment) above a query silently clips the end off every query after
 * it. And the engine imports a type-stripped copy of the generated TypeScript,
 * which must never drift from it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fakeD1 } from "../test/fake-d1.js";
import { strippedQuerier } from "../db/strip-gen.mjs";
import { ENGINE_VERSION } from "./version.js";

const DB = join(import.meta.dirname, "..", "db");

test("query.sql is pure ASCII", () => {
  const text = readFileSync(join(DB, "query.sql"), "utf8");
  const bad = [...text].findIndex((ch) => ch.charCodeAt(0) > 127);
  assert.equal(bad, -1, `non-ASCII at offset ${bad}: sqlc-gen-ts-d1 would clip the generated queries`);
});

test("every generated query prepares against the real migrations", () => {
  const generated = readFileSync(join(DB, "gen", "querier.ts"), "utf8");
  const queries = [...generated.matchAll(/const (\w+)Query = `([\s\S]*?)`;/g)];
  const names = [...readFileSync(join(DB, "query.sql"), "utf8").matchAll(/^-- name: (\w+)/gm)];
  assert.equal(queries.length, names.length, "db/gen is stale - run clog sqlc");
  const { sqlite } = fakeD1();
  for (const [, name, sql] of queries) {
    assert.doesNotThrow(() => sqlite.prepare(sql), `${name}: ${sql}`);
  }
});

test("db/gen/querier.js is querier.ts with the types stripped", () => {
  const committed = readFileSync(join(DB, "gen", "querier.js"), "utf8");
  assert.equal(committed, strippedQuerier(), "db/gen/querier.js is stale - run clog sqlc");
});

test("ENGINE_VERSION matches package.json", () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"));
  assert.equal(ENGINE_VERSION, pkg.version);
});
