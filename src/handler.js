/**
 * The request flow, shared by every form.
 *
 *   GET  /        -> the form
 *   POST /        -> honeypot -> Turnstile -> validate -> email -> thank-you
 *   GET  /health  -> a small JSON status page, handy for checking a deploy
 *   GET  /api/v1/* -> the reader API over the submission log (reader.js)
 *
 *   ?embed=1 on GET or POST renders for an iframe on the site: no header or
 *   footer (see EMBED MODE in render.js).
 *
 * Ordering matters and is deliberate: the cheap local checks run before the
 * network call to Turnstile, so junk traffic costs us nothing.
 *
 * With a FORM_DB binding, every POST - whatever its outcome - also leaves one
 * row in D1 (store.js). The row is written AFTER the outcome is known and
 * never changes the response: by then the email has gone, and an error page
 * would only make the visitor send it again.
 *
 * A form directory supplies only its questions and its wording; everything
 * below is identical for all of them. The site (name, URL, colours, fonts) is
 * the consumer's site.js, shared by every form on that site.
 */

import { validate } from "./validate.js";
import { renderForm, renderSuccess, TOKENS } from "./render.js";
import { sendFormEmail, isConfigured } from "./email.js";
import { trippedHoneypot, verifyTurnstile, RENDERED_FIELD } from "./turnstile.js";
import { STORE_BINDING, buildRow, logSubmission } from "./store.js";
import { readerConfigured } from "./access.js";
import { API_PREFIX, handleReader } from "./reader.js";

// frame-ancestors 'self': only the site itself may put these pages in an iframe
// (the Workers are routed on the site's own domain, so that is same-origin). Any
// other page framing a form — to overlay it and harvest input, say — is refused.
const HTML = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "frame-ancestors 'self'",
};
const html = (body, status = 200) => new Response(body, { status, headers: HTML });

/**
 * @param {object} form
 * @param {string} form.id               e.g. "contact" — used in logs and the From: name
 * @param {Array}  form.fields           the FIELDS array
 * @param {object} form.copy             page wording
 * @param {(v: Record<string,string>) => string} form.subject
 * @param {string} form.senderVar        env var holding the From: address
 * @param {string} form.recipientVar     env var holding the To: address
 * @param {string} form.replyNameField   field whose value becomes the Reply-To name
 * @param {string} form.replyEmailField  field whose value becomes the Reply-To address
 * @param {object} form.site             site.js - name, url, lang, fonts, theme
 * @param {string} [form.version]        the form's own version, recorded in the log
 * @param {number} [form.retainDays]     prune logged rows older than this; default keep
 * @returns {{fetch: (req: Request, env: object, ctx?: ExecutionContext) => Promise<Response>}}
 */
export function createHandler(form) {
  assertForm(form);
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      // SITE_NAME overrides site.name per Worker (wrangler var), e.g. for a test
      const eventName = env.SITE_NAME || form.site.name;
      const siteKey = env.TURNSTILE_SITE_KEY || "";
      const embed = url.searchParams.get("embed") === "1";
      const page = (opts) => renderForm({ form, siteKey, eventName, embed, ...opts });
      const success = () => renderSuccess({ form, eventName, embed });

      if (url.pathname.endsWith("/health")) {
        return Response.json({
          ok: true,
          form: form.id,
          dryRun: env.DRY_RUN === "true",
          mailtrapConfigured: Boolean(env.MAILTRAP_API_TOKEN),
          senderConfigured: isConfigured(env[form.senderVar]),
          recipientConfigured: isConfigured(env[form.recipientVar]),
          turnstileConfigured: Boolean(env.TURNSTILE_SECRET_KEY),
          storeConfigured: Boolean(env[STORE_BINDING]),
          readerConfigured: readerConfigured(env),
        });
      }

      const api = url.pathname.indexOf(`${API_PREFIX}/`);
      if (api !== -1) {
        return handleReader({ request, env, form, rest: url.pathname.slice(api + API_PREFIX.length) });
      }

      if (request.method === "GET" || request.method === "HEAD") {
        return html(page({}));
      }

      if (request.method !== "POST") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { allow: "GET, HEAD, POST" },
        });
      }

      // Every exit below goes through finish(): it logs the outcome (when there
      // is a store) and returns the response untouched.
      const receivedAt = new Date();
      let data = null;
      const finish = async (response, outcome, statusMessage, extra = {}) => {
        const db = env[STORE_BINDING];
        if (db) {
          const row = buildRow({ form, request, data, receivedAt, outcome,
            status: response.status, statusMessage, ...extra });
          const write = logSubmission(db, form, row).catch((err) =>
            console.error(`[${form.id}] submission log failed: ${err.stack || err}`));
          if (ctx?.waitUntil) ctx.waitUntil(write);
          else await write;
        }
        return response;
      };

      try {
        data = await request.formData();
      } catch {
        return finish(html(page({ formError: "We could not read that submission. Please try again." }), 400),
          "invalid", "unreadable body");
      }
      const renderedAt = data.get(RENDERED_FIELD) ?? "";

      // 1. Honeypot. A bot that fills the hidden field gets the ordinary
      //    thank-you page and nothing is sent — see turnstile.js for why we do
      //    not tell it that it was caught.
      if (trippedHoneypot(data)) {
        console.log(`[${form.id}] honeypot tripped — submission dropped`);
        return finish(html(success()), "honeypot", "honeypot", { honeypot: true });
      }

      // 2. Turnstile.
      const turnstile = await verifyTurnstile(
        data.get("cf-turnstile-response"),
        env.TURNSTILE_SECRET_KEY,
        request.headers.get("CF-Connecting-IP")
      );
      if (!turnstile.ok) {
        console.log(`[${form.id}] turnstile rejected: ${turnstile.reason}`);
        const { values } = validate(data, form.fields);
        return finish(html(
          page({
            values,
            renderedAt,
            formError:
              turnstile.reason === "turnstile-not-configured"
                ? "This form is not fully configured yet. Please contact us instead."
                : "We could not verify that you are human. Please try the check again.",
          }),
          403
        ), "turnstile", turnstile.reason, { turnstile });
      }

      // 3. Validation. Re-renders with the sender's answers intact — nobody
      //    should have to retype a long message because of one typo.
      const { ok, values, errors } = validate(data, form.fields);
      if (!ok) {
        // Field names only: what someone half-typed into a rejected form is not kept.
        return finish(html(page({ values, errors, renderedAt }), 400),
          "invalid", `invalid: ${Object.keys(errors).join(", ")}`, { turnstile });
      }

      // 4. Send.
      const meta = {
        submittedAt: new Date().toISOString(),
        ip: request.headers.get("CF-Connecting-IP"),
        country: request.cf?.country,
      };

      let result;
      try {
        result = await sendFormEmail({ form, values, env, meta });
        console.log(`[${form.id}] ${result.dryRun ? "dry run — not sent" : "emailed"}`);
      } catch (err) {
        // Never show a success page for an email that did not go. Someone who
        // thinks their message went through waits for a reply that never comes.
        console.error(`[${form.id}] send failed: ${err.stack || err}`);
        return finish(html(
          page({
            values,
            renderedAt,
            formError:
              "Sorry — we could not send your message just now. Please try again in a few minutes, or contact us directly.",
          }),
          502
        ), "send-failed", String(err.message || err).split("\n")[0], { values, turnstile });
      }

      return finish(html(success()), "sent", result.dryRun ? "dry run - not emailed" : "",
        { values, turnstile });
    },
  };
}

/**
 * Check a form definition at construction, so a mistake is a deploy-time error
 * rather than a broken page or a message that silently goes nowhere. Runs once
 * when the Worker module loads: `wrangler deploy` fails, and so does the test
 * suite of the site that owns the form.
 */
function assertForm(form) {
  const bad = (msg) => { throw new Error(`cf-form-mailer: ${msg}`); };
  // "set" means present AND usable: an explicit undefined or "" is as broken as
  // an absent key, and reads the same on the page.
  const has = (o, k) => Boolean(o) && o[k] !== undefined && o[k] !== null && o[k] !== "";

  for (const k of ["id", "fields", "copy", "site", "senderVar", "recipientVar",
                   "replyNameField", "replyEmailField", "subject"]) {
    if (!has(form, k)) bad(`form.${k} is missing`);
  }
  if (typeof form.subject !== "function") bad("form.subject must be a function");
  if (form.version !== undefined && typeof form.version !== "string") bad("form.version must be a string");
  if (form.retainDays !== undefined && !(Number.isInteger(form.retainDays) && form.retainDays > 0)) {
    bad("form.retainDays must be a whole number of days, 1 or more");
  }
  if (!Array.isArray(form.fields) || form.fields.length === 0) bad("form.fields must be a non-empty array");

  const names = new Set();
  for (const f of form.fields) {
    for (const k of ["name", "label", "type"]) {
      if (!has(f, k)) bad(`every field needs a ${k} (field ${JSON.stringify(f.name ?? f)})`);
    }
    if (names.has(f.name)) bad(`two fields are called "${f.name}"`);
    names.add(f.name);
    if (f.type === "radio" && !Array.isArray(f.options)) bad(`field "${f.name}" is a radio with no options`);
  }
  // The Reply-To is how anyone answers the message. A typo here is invisible
  // until a real submission arrives with no way to reply to it.
  for (const k of ["replyNameField", "replyEmailField"]) {
    if (!names.has(form[k])) bad(`form.${k} is "${form[k]}", which is not one of the fields`);
  }
  for (const k of ["title", "heading", "submit", "successTitle", "successBody", "emailIntro"]) {
    if (!has(form.copy, k)) bad(`form.copy.${k} is missing`);
  }

  const { site } = form;
  for (const k of ["name", "url", "fonts", "theme"]) if (!has(site, k)) bad(`form.site.${k} is missing`);
  for (const k of ["body", "heading"]) if (!has(site.fonts, k)) bad(`form.site.fonts.${k} is missing`);
  try { new URL(site.url); } catch { bad(`form.site.url ("${site.url}") is not an absolute URL`); }

  const { light, dark } = site.theme;
  if (!light && !dark) bad("form.site.theme needs a light block, a dark block, or both");
  for (const [which, block] of [["light", light], ["dark", dark]]) {
    if (!block) continue;
    const missing = TOKENS.filter((t) => !has(block, t));
    if (missing.length) bad(`form.site.theme.${which} is missing ${missing.join(", ")}`);
  }
}
