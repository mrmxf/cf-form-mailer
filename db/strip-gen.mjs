//  Copyright ©2017-2026  Mr MXF   info@mrmxf.com
//  BSD-3-Clause License           https://opensource.org/license/bsd-3-clause/
/**
 * db/gen/querier.ts -> db/gen/querier.js, the file the engine imports.
 *
 * The engine is plain JS with no build step, and it ships from node_modules,
 * where Node refuses to strip types. So `clog sqlc` strips them once, here, and
 * both files are committed. db.test.js re-strips and compares, so a stale .js
 * cannot ship.
 *
 *   node db/strip-gen.mjs        (run by `clog sqlc`)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";

const GEN = join(import.meta.dirname, "gen");
const HEADER = "// Generated: type-stripped from querier.ts by db/strip-gen.mjs. DO NOT EDIT - run `clog sqlc`.\n";

/** The .js that querier.ts should produce. */
export function strippedQuerier() {
  const ts = readFileSync(join(GEN, "querier.ts"), "utf8");
  // "strip" blanks types in place; drop the trailing whitespace it leaves so the
  // committed file diffs cleanly.
  return HEADER + stripTypeScriptTypes(ts, { mode: "strip" }).replace(/[ \t]+$/gm, "");
}

if (import.meta.main) {
  writeFileSync(join(GEN, "querier.js"), strippedQuerier());
  console.log("wrote db/gen/querier.js");
}
