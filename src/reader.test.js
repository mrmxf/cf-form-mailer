/**
 * The reader API: Access fails closed, and the listing speaks records, not rows.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createHandler } from "./handler.js";
import { resetAccessCache } from "./access.js";
import { fakeD1 } from "../test/fake-d1.js";
import { FORM, ENV } from "../test/fixtures.js";

const TEAM = "https://team.example.test";
const AUD = "aud-tag-1";
const handler = createHandler(FORM);

// ── a signing key standing in for the Access team's, and one that is not ──────
const ALG = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
const teamKey = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
const otherKey = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
const JWKS = { keys: [{ ...(await crypto.subtle.exportKey("jwk", teamKey.publicKey)), kid: "k1" }] };

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
async function jwt(claims = {}, { key = teamKey.privateKey, header = { alg: "RS256", kid: "k1" } } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: TEAM, aud: [AUD], email: "staff@example.test", iat: now, nbf: now, exp: now + 300, ...claims };
  const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

beforeEach(() => resetAccessCache());

function stubCerts(t) {
  const f = t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url) === `${TEAM}/cdn-cgi/access/certs`) return Response.json(JWKS);
    throw new Error(`unexpected fetch ${url}`);
  });
  t.mock.method(console, "log", () => {});
  return f;
}

const api = (path, token, host = "example.test") => new Request(`https://${host}/forms/contact/api/v1${path}`,
  { headers: token ? { "cf-access-jwt-assertion": token } : {} });

function seeded() {
  const db = fakeD1();
  const ins = db.sqlite.prepare(`INSERT INTO submissions (uid, form, url, timestamp, schema_version, outcome,
    form_meta, answers, session, workflow) VALUES (?, ?, 'https://example.test/forms/contact/', ?, 1, ?,
    '{"id":"contact"}', ?, '{}', '{"events":[]}')`);
  // five sent, two at the same millisecond; one spam; one for another form
  const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  ins.run(uid(1), "contact", "2026-10-01T10:00:00.000Z", "sent", '{"name":"A"}');
  ins.run(uid(2), "contact", "2026-10-02T10:00:00.000Z", "sent", '{"name":"B"}');
  ins.run(uid(3), "contact", "2026-10-03T10:00:00.000Z", "honeypot", "{}");
  ins.run(uid(4), "contact", "2026-10-04T10:00:00.000Z", "sent", '{"name":"C"}');
  ins.run(uid(5), "contact", "2026-10-04T10:00:00.000Z", "sent", '{"name":"D"}');
  ins.run(uid(6), "contact", "2026-10-05T10:00:00.000Z", "sent", '{"name":"E"}');
  ins.run(uid(7), "parking", "2026-10-06T10:00:00.000Z", "sent", '{"name":"other form"}');
  return { db, uid, env: { ...ENV, DRY_RUN: "false", FORM_DB: db.d1, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD } };
}

const get = async (path, env, token) => {
  const res = await handler.fetch(api(path, token), env);
  return { status: res.status, body: await res.json(), res };
};

// ── Access ─────────────────────────────────────────────────────────────────────

test("fails closed without D1 or without Access configuration", async (t) => {
  stubCerts(t);
  const { env } = seeded();
  assert.equal((await get("/summary", { ...env, FORM_DB: undefined }, await jwt())).status, 503);
  const r = await get("/summary", { ...env, ACCESS_AUD: "" }, await jwt());
  assert.equal(r.status, 503);
  assert.equal(r.body.error, "reader-not-configured");
});

test("refuses every token that is not a valid Access token for this app", async (t) => {
  stubCerts(t);
  const { env } = seeded();
  const now = Math.floor(Date.now() / 1000);
  const bad = {
    missing: undefined,
    garbage: "not.a.jwt",
    expired: await jwt({ exp: now - 1 }),
    "not yet valid": await jwt({ nbf: now + 3600 }),
    "wrong audience": await jwt({ aud: ["someone-else"] }),
    "wrong issuer": await jwt({ iss: "https://evil.example.test" }),
    "someone else's key": await jwt({}, { key: otherKey.privateKey }),
    "unknown kid": await jwt({}, { header: { alg: "RS256", kid: "k9" } }),
    "alg none": `${b64url(JSON.stringify({ alg: "none", kid: "k1" }))}.${b64url(JSON.stringify({ iss: TEAM, aud: [AUD], exp: now + 300 }))}.`,
  };
  for (const [why, token] of Object.entries(bad)) {
    const r = await get("/summary", env, token);
    assert.equal(r.status, 403, why);
    assert.deepEqual(r.body, { error: "forbidden" }, why);
  }
});

test("a valid Access token is let in, and the keys are fetched once", async (t) => {
  const f = stubCerts(t);
  const { env } = seeded();
  assert.equal((await get("/summary", env, await jwt())).status, 200);
  assert.equal((await get("/summary", env, await jwt())).status, 200);
  assert.equal(f.mock.callCount(), 1);
  // the team domain may be given without a scheme
  assert.equal((await get("/summary", { ...env, ACCESS_TEAM_DOMAIN: "team.example.test" }, await jwt())).status, 200);
});

test("the wrangler dev bypass needs BOTH localhost AND a dry run", async (t) => {
  stubCerts(t);
  const { env } = seeded();
  const noAccess = { ...env, ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" };
  const at = async (host, dry) => (await handler.fetch(api("/summary", undefined, host), { ...noAccess, DRY_RUN: dry })).status;
  assert.equal(await at("localhost:8787", "true"), 200);
  assert.equal(await at("localhost:8787", "false"), 503);
  assert.equal(await at("example.test", "true"), 503);
});

// ── the API ────────────────────────────────────────────────────────────────────

test("summary: counts, first and latest, overall and per outcome, this form only", async (t) => {
  stubCerts(t);
  const { env } = seeded();
  const { body } = await get("/summary", env, await jwt());
  assert.deepEqual(body, {
    form: "contact", total: 6, first: "2026-10-01T10:00:00.000Z", latest: "2026-10-05T10:00:00.000Z",
    byOutcome: {
      honeypot: { count: 1, first: "2026-10-03T10:00:00.000Z", latest: "2026-10-03T10:00:00.000Z" },
      sent: { count: 5, first: "2026-10-01T10:00:00.000Z", latest: "2026-10-05T10:00:00.000Z" },
    },
  });
});

test("list: newest first, sent only by default, records not rows", async (t) => {
  stubCerts(t);
  const { env } = seeded();
  const { status, body, res } = await get("/submissions?limit=3", env, await jwt());
  assert.equal(status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(body.items.map((r) => r.answers.name), ["E", "D", "C"]);
  assert.ok(body.next);
  assert.deepEqual(Object.keys(body.items[0]).sort(),
    ["answers", "form", "formMeta", "id", "outcome", "schemaVersion", "session", "timestamp", "url", "workflow"]);
  assert.equal(typeof body.items[0].formMeta, "object", "JSON columns are parsed");
});

test("list: the cursor walks every page once, across a shared timestamp", async (t) => {
  stubCerts(t);
  const { env } = seeded();
  for (const [order, want] of [["newest", ["E", "D", "C", "B", "A"]], ["oldest", ["A", "B", "C", "D", "E"]]]) {
    const seen = [];
    let cursor = "";
    do {
      const { body } = await get(`/submissions?limit=2&order=${order}${cursor && `&cursor=${cursor}`}`, env, await jwt());
      seen.push(...body.items.map((r) => r.answers.name));
      cursor = body.next;
    } while (cursor);
    assert.deepEqual(seen, want, order);
  }
});

test("list: from, outcome=all and outcome=honeypot", async (t) => {
  stubCerts(t);
  const { env } = seeded();
  const names = async (q) => (await get(`/submissions?${q}`, env, await jwt())).body.items.map((r) => r.answers.name ?? r.outcome);
  assert.deepEqual(await names("from=2026-10-02T12:00:00Z"), ["B", "A"]);
  assert.deepEqual(await names("from=2026-10-04&order=oldest"), ["C", "D", "E"]);
  assert.deepEqual(await names("outcome=all&from=2026-10-03T23:00:00Z"), ["honeypot", "B", "A"]);
  assert.deepEqual(await names("outcome=honeypot"), ["honeypot"]);
});

test("list: bad parameters are a 400 that says why", async (t) => {
  stubCerts(t);
  const { env } = seeded();
  const token = await jwt();
  const { body: page } = await get("/submissions?limit=1&order=oldest", env, token);
  for (const [q, error] of [["limit=0", "bad-limit"], ["limit=101", "bad-limit"], ["limit=abc", "bad-limit"],
    ["order=sideways", "bad-order"], ["outcome=spam", "bad-outcome"], ["from=yesterday", "bad-from"],
    ["cursor=xyz", "bad-cursor"], [`cursor=${page.next}`, "bad-cursor"]]) {  // an oldest cursor used for newest
    const r = await get(`/submissions?${q}`, env, token);
    assert.equal(r.status, 400, q);
    assert.equal(r.body.error, error, q);
  }
});

test("one record by id; another form's record is not found", async (t) => {
  stubCerts(t);
  const { env, uid } = seeded();
  const token = await jwt();
  const one = await get(`/submissions/${uid(2)}`, env, token);
  assert.equal(one.status, 200);
  assert.equal(one.body.id, uid(2));
  assert.equal((await get(`/submissions/${uid(7)}`, env, token)).status, 404);
  assert.equal((await get("/nope", env, token)).status, 404);
});

test("the API is read-only", async (t) => {
  stubCerts(t);
  const { env } = seeded();
  const res = await handler.fetch(new Request("https://example.test/forms/contact/api/v1/summary", { method: "POST" }), env);
  assert.equal(res.status, 405);
});
