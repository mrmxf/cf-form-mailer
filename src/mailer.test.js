/**
* Every promise this package makes, tested here:
 *   npm test        (node --test "src/*.test.js")
 *
 * Covers the security-relevant paths (header injection, HTML escaping, fail
 * closed without Turnstile, honeypot) and the site theming. Needs no network:
 * the Turnstile call is a stubbed fetch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { headerSafe, sendFormEmail } from "./email.js";
import { validate } from "./validate.js";
import { renderForm } from "./render.js";
import { createHandler } from "./handler.js";
import { HONEYPOT_FIELD } from "./turnstile.js";

const tokens = (c) => ({
  "primary": c, "primary-hover": c, "on-primary": c, "error": c, "error-bg": c,
  "bg": c, "surface": c, "body": c, "meta": c, "link": c, "border": c,
});
const SITE = {
  name: "Test Site", url: "https://example.test", lang: "en-GB",
  fonts: { href: "", body: "sans-serif", heading: "serif" },
  theme: { light: tokens("#fff"), dark: tokens("#000") },
};
const FIELDS = [
  { name: "name", label: "Your name", type: "text", required: true, maxLength: 20 },
  { name: "email", label: "Email address", type: "email", required: true, maxLength: 254 },
  { name: "message", label: "Your message", type: "textarea", required: true, maxLength: 200 },
];
const FORM = {
  id: "contact", site: SITE, fields: FIELDS,
  copy: { title: "Contact", heading: "Contact", submit: "Send", intro: "", successTitle: "Sent",
    successBody: "<p>ok</p>", emailIntro: "A message." },
  senderVar: "CONTACT_SENDER", recipientVar: "CONTACT_RECIPIENT",
  replyNameField: "name", replyEmailField: "email",
  subject: (v) => `contact: ${v.name}`,
};
const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const post = (o, q = "") => new Request(`https://example.test/forms/contact/${q}`, { method: "POST", body: fd(o) });

test("headerSafe strips CR/LF so a name cannot inject a header", () => {
  assert.equal(headerSafe("Jane\r\nBcc: evil@x.test"), "Jane Bcc: evil@x.test");
  assert.equal(headerSafe(undefined), "");
});

test("validate: required, maxLength, email shape; textarea keeps its newlines", () => {
  const bad = validate(fd({ name: "x".repeat(21), email: "nope", message: "" }), FIELDS);
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ["email", "message", "name"]);
  const good = validate(fd({ name: " Jane  Doe ", email: "j@x.test", message: "a\r\nb" }), FIELDS);
  assert.equal(good.ok, true);
  assert.equal(good.values.name, "Jane Doe");
  assert.equal(good.values.message, "a\nb");
});

test("render escapes submitted values and uses the site theme", () => {
  const html = renderForm({ form: FORM, siteKey: "k", eventName: SITE.name,
    values: { name: `"><script>alert(1)</script>` } });
  assert.ok(!html.includes("<script>alert(1)"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("prefers-color-scheme: dark"), "light+dark theme follows the OS");
  assert.ok(html.includes('data-theme="auto"'));
  assert.ok(html.includes('lang="en-GB"'));
  assert.ok(html.includes('href="https://example.test"'));
});

test("a dark-only theme is forced dark", () => {
  const form = { ...FORM, site: { ...SITE, theme: { dark: tokens("#000") } } };
  const html = renderForm({ form, siteKey: "k", eventName: SITE.name });
  assert.ok(!html.includes("prefers-color-scheme"));
  assert.ok(html.includes('data-theme="dark"'));
});

const handler = createHandler(FORM);
const ENV = { TURNSTILE_SITE_KEY: "k", DRY_RUN: "true",
  CONTACT_SENDER: "no-reply@example.test", CONTACT_RECIPIENT: "to@example.test" };
const VALID = { name: "Jane", email: "j@x.test", message: "hello", "cf-turnstile-response": "tok" };

test("GET serves the form; /health reports configuration", async () => {
  const get = await handler.fetch(new Request("https://example.test/forms/contact/"), ENV);
  assert.equal(get.status, 200);
  assert.match(get.headers.get("content-security-policy"), /frame-ancestors 'self'/);
  const health = await (await handler.fetch(new Request("https://example.test/forms/contact/health"), ENV)).json();
  assert.equal(health.dryRun, true);
  assert.equal(health.turnstileConfigured, false);
});

test("fails closed: no Turnstile secret means no submission is accepted", async () => {
  const res = await handler.fetch(post(VALID), ENV);
  assert.equal(res.status, 403);
});

test("a tripped honeypot gets the ordinary thank-you page and sends nothing", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not call out"); });
  const res = await handler.fetch(post({ ...VALID, [HONEYPOT_FIELD]: "bot" }), ENV);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Thank you/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("valid + verified -> thank-you (dry run); a failed send never thanks", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("turnstile")) return Response.json({ success: true });
    return new Response("nope", { status: 500 });           // Mailtrap down
  });
  const env = { ...ENV, TURNSTILE_SECRET_KEY: "s" };
  t.mock.method(console, "log", () => {});
  const ok = await handler.fetch(post(VALID), env);
  assert.equal(ok.status, 200);

  t.mock.method(console, "error", () => {});
  const down = await handler.fetch(post(VALID), { ...env, DRY_RUN: "false", MAILTRAP_API_TOKEN: "t" });
  assert.equal(down.status, 502);
  assert.doesNotMatch(await down.text(), /Thank you/);
});

test("sendFormEmail refuses a TODO recipient", async () => {
  await assert.rejects(
    sendFormEmail({ form: FORM, values: { name: "J", email: "j@x.test", message: "m" },
      env: { ...ENV, DRY_RUN: "false", MAILTRAP_API_TOKEN: "t", CONTACT_RECIPIENT: "TODO-x" },
      meta: { submittedAt: "now" } }),
    /not configured/);
});

// --- the definition guard: a broken form must fail at deploy, not at a submit ---

const def = (over = {}) => ({ ...FORM, ...over });
const throws = (over, re) => assert.throws(() => createHandler(def(over)), re);

test("createHandler accepts a complete definition", () => {
  assert.doesNotThrow(() => createHandler(def()));
});

test("createHandler rejects a definition that would break a live form", () => {
  throws({ fields: [] }, /non-empty array/);
  throws({ subject: "not a function" }, /must be a function/);
  throws({ replyEmailField: "emial" }, /not one of the fields/);
  throws({ copy: { ...FORM.copy, emailIntro: undefined } }, /copy\.emailIntro/);
  throws({ fields: [...FIELDS, FIELDS[0]] }, /two fields are called "name"/);
  throws({ fields: [{ name: "x", label: "X" }] }, /needs a type/);
  throws({ fields: [{ name: "x", label: "X", type: "radio" }] }, /radio with no options/);
});

test("createHandler rejects an incomplete site theme", () => {
  const { border, ...short } = tokens("#fff");
  throws({ site: { ...SITE, theme: { light: short } } }, /theme\.light is missing border/);
  throws({ site: { ...SITE, theme: {} } }, /light block, a dark block, or both/);
  throws({ site: { ...SITE, url: "mrmxf.com" } }, /not an absolute URL/);
  throws({ site: { ...SITE, fonts: { body: "sans-serif" } } }, /fonts\.heading/);
});
