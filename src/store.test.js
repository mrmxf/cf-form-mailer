/**
 * The submission log: one row per POST, every outcome, never an IP, and never
 * a changed response.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createHandler } from "./handler.js";
import { buildRow } from "./store.js";
import { HONEYPOT_FIELD, RENDERED_FIELD } from "./turnstile.js";
import { ENGINE_VERSION } from "./version.js";
import { fakeD1 } from "../test/fake-d1.js";
import { FORM, ENV, VALID, fd } from "../test/fixtures.js";

const IP = "203.0.113.77";
const handler = createHandler(FORM);

function post(body, { q = "", cf = { country: "GB", asn: 64500, colo: "LHR" } } = {}) {
  const req = new Request(`https://example.test/forms/contact/${q}`, {
    method: "POST", body: fd(body),
    headers: { "CF-Connecting-IP": IP, "user-agent": "TestBrowser/1.0", "accept-language": "en-GB" },
  });
  Object.defineProperty(req, "cf", { value: cf });   // the Workers runtime sets this
  return req;
}

// Turnstile passes; Mailtrap answers `mail`.
function stubFetch(t, mail = 200) {
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("turnstile")) {
      return Response.json({ success: true, hostname: "example.test", challenge_ts: "2026-01-01T00:00:00Z", action: "" });
    }
    return new Response("mail says", { status: mail });
  });
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "error", () => {});
}

const withDb = (over = {}) => {
  const db = fakeD1();
  return { db, env: { ...ENV, TURNSTILE_SECRET_KEY: "s", FORM_DB: db.d1, ...over } };
};
const rowsOf = (db) => db.rows("SELECT * FROM submissions ORDER BY id").map((r) => ({
  ...r, form_meta: JSON.parse(r.form_meta), answers: JSON.parse(r.answers),
  session: JSON.parse(r.session), workflow: JSON.parse(r.workflow),
}));

test("sent: one row, answers kept, workflow has the submit event", async (t) => {
  stubFetch(t);
  const { db, env } = withDb();
  const rendered = new Date(Date.now() - 42_000).toISOString();
  const res = await handler.fetch(post({ ...VALID, [RENDERED_FIELD]: rendered }, { q: "?embed=1" }), env);
  assert.equal(res.status, 200);

  const [row, ...more] = rowsOf(db);
  assert.equal(more.length, 0);
  assert.equal(row.form, "contact");
  assert.equal(row.url, "https://example.test/forms/contact/?embed=1");
  assert.equal(row.schema_version, 1);
  assert.equal(row.outcome, "sent");
  assert.match(row.uid, /^[0-9a-f-]{36}$/);
  assert.deepEqual(row.answers, { name: "Jane", email: "j@x.test", message: "hello" });
  assert.deepEqual(row.form_meta, { id: "contact", version: "3", engine: ENGINE_VERSION,
    fields: [{ name: "name", type: "text", required: true }, { name: "email", type: "email", required: true },
      { name: "message", type: "textarea", required: true }] });
  const [ev, ...moreEv] = row.workflow.events;
  assert.equal(moreEv.length, 0);
  assert.deepEqual({ ...ev, timestamp: "" }, { event: "submit", timestamp: "", status: 200, statusMessage: "dry run - not emailed" });

  const s = row.session;
  assert.equal(s.embed, true);
  assert.equal(s.country, "GB");
  assert.equal(s.asn, 64500);
  assert.equal(s.userAgent, "TestBrowser/1.0");
  assert.equal(s.honeypot, false);
  assert.equal(s.turnstile.success, true);
  assert.equal(s.turnstile.hostname, "example.test");
  assert.equal(s.renderedAt, rendered);
  assert.ok(s.elapsedMs >= 42_000 && s.elapsedMs < 60_000, `elapsedMs ${s.elapsedMs}`);
});

test("each outcome is logged with its status; answers only for sent/send-failed", async (t) => {
  stubFetch(t, 500);
  const { db, env } = withDb();
  const live = { ...env, DRY_RUN: "false", MAILTRAP_API_TOKEN: "t" };

  assert.equal((await handler.fetch(post(VALID), live)).status, 502);
  assert.equal((await handler.fetch(post({ ...VALID, email: "" }), env)).status, 400);
  assert.equal((await handler.fetch(post(VALID), { ...env, TURNSTILE_SECRET_KEY: "" })).status, 403);
  assert.equal((await handler.fetch(post({ ...VALID, [HONEYPOT_FIELD]: "bot" }), env)).status, 200);

  const got = rowsOf(db).map((r) => [r.outcome, r.workflow.events[0].status, r.workflow.events[0].statusMessage,
    Object.keys(r.answers).length > 0]);
  assert.deepEqual(got, [
    ["send-failed", 502, "mailtrap 500: mail says", true],
    ["invalid", 400, "invalid: email", false],
    ["turnstile", 403, "turnstile-not-configured", false],
    ["honeypot", 200, "honeypot", false],
  ]);
  const hp = rowsOf(db)[3].session;
  assert.equal(hp.honeypot, true);
  assert.equal(hp.turnstile, null, "Turnstile never ran for a honeypot trip");
});

test("buildRow drops answers for every outcome but sent/send-failed, whatever it is given", () => {
  const values = { name: "Jane" };
  const row = (outcome) => JSON.parse(buildRow({ form: FORM, request: post(VALID), data: null,
    receivedAt: new Date(), outcome, status: 200, statusMessage: "", values }).answers);
  for (const o of ["invalid", "turnstile", "honeypot"]) assert.deepEqual(row(o), {}, o);
  for (const o of ["sent", "send-failed"]) assert.deepEqual(row(o), values, o);
  assert.throws(() => row("maybe"), /unknown outcome/);
});

test("no row holds the visitor's IP address", async (t) => {
  stubFetch(t);
  const { db, env } = withDb();
  await handler.fetch(post(VALID), env);
  await handler.fetch(post({ ...VALID, email: "" }), env);
  for (const r of db.rows("SELECT * FROM submissions")) {
    assert.ok(!JSON.stringify(r).includes(IP), "IP found in a logged row");
  }
});

test("a failing D1 never changes the response", async (t) => {
  stubFetch(t);
  const { db, env } = withDb();
  db.d1.batch = async () => { throw new Error("D1 is down"); };
  const res = await handler.fetch(post(VALID), env);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Sent/);
  assert.match(console.error.mock.calls.at(-1).arguments[0], /submission log failed/);
});

test("with ctx, the write goes to waitUntil", async (t) => {
  stubFetch(t);
  const { db, env } = withDb();
  const pending = [];
  await handler.fetch(post(VALID), env, { waitUntil: (p) => pending.push(p) });
  assert.equal(pending.length, 1);
  await Promise.all(pending);
  assert.equal(db.rows("SELECT id FROM submissions").length, 1);
});

test("retainDays prunes this form's old rows, and only this form's", async (t) => {
  stubFetch(t);
  const { db, env } = withDb();
  const old = "2000-01-01T00:00:00.000Z";
  const ins = "INSERT INTO submissions (uid, form, url, timestamp, schema_version, outcome, form_meta, answers, session, workflow) VALUES (?, ?, 'u', ?, 1, 'sent', '{}', '{}', '{}', '{}')";
  db.sqlite.prepare(ins).run("old-contact", "contact", old);
  db.sqlite.prepare(ins).run("old-parking", "parking", old);

  await createHandler({ ...FORM, retainDays: 30 }).fetch(post(VALID), env);
  const uids = db.rows("SELECT uid, form FROM submissions ORDER BY id").map((r) => r.form + ":" + (r.uid.startsWith("old") ? "old" : "new"));
  assert.deepEqual(uids, ["parking:old", "contact:new"]);
});

test("no FORM_DB: nothing is logged and /health says so", async (t) => {
  stubFetch(t);
  const res = await handler.fetch(post(VALID), { ...ENV, TURNSTILE_SECRET_KEY: "s" });
  assert.equal(res.status, 200);
  const health = await (await handler.fetch(new Request("https://example.test/forms/contact/health"), ENV)).json();
  assert.equal(health.storeConfigured, false);
  assert.equal(health.readerConfigured, false);
});

test("the form carries its render time, and a re-render keeps the first one", async (t) => {
  stubFetch(t);
  const { env } = withDb();
  const first = "2026-01-01T10:00:00.000Z";
  const html = await (await handler.fetch(post({ ...VALID, email: "", [RENDERED_FIELD]: first }), env)).text();
  assert.ok(html.includes(`name="${RENDERED_FIELD}" value="${first}"`));
  const bogus = await (await handler.fetch(post({ ...VALID, email: "", [RENDERED_FIELD]: `"><script>` }), env)).text();
  assert.ok(!bogus.includes("<script>\""), "a junk render time is replaced, never echoed");
});

test("createHandler checks version and retainDays", () => {
  assert.throws(() => createHandler({ ...FORM, version: 3 }), /version must be a string/);
  assert.throws(() => createHandler({ ...FORM, retainDays: 0 }), /retainDays/);
  assert.throws(() => createHandler({ ...FORM, retainDays: 1.5 }), /retainDays/);
});
