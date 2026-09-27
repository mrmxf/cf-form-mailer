/**
 * The submission log: one D1 row per POST, whatever happened to it.
 *
 * Opt-in. With no FORM_DB binding in env nothing here runs and the engine
 * behaves exactly as it did before the log existed.
 *
 * ── THE ROW ────────────────────────────────────────────────────────────────────
 * Columns are db/migrations; queries are db/query.sql, compiled by sqlc into
 * db/gen/querier.js. Four columns are JSON documents built below:
 *
 *   form_meta  {id, version, engine, fields:[{name, type, required}]}
 *   answers    the validated field values - ONLY for sent / send-failed. A bot's
 *              junk or a half-typed rejected form is not worth keeping.
 *   session    browser and anti-spam signals. NEVER an IP address: country, ASN
 *              and colo say enough about where a submission came from.
 *   workflow   {"events":[{event, timestamp, status, statusMessage}]}. Only
 *              "submit" today; a later phase appends with json_insert.
 *
 * ── CHANGING THE LAYOUT ────────────────────────────────────────────────────────
 * Add a migration, bump ROW_SCHEMA, and give toRecord() a branch for the new
 * layout. Old rows keep their schema_version forever, so the reader API must
 * go on understanding them: toRecord() is where that is absorbed, and why the
 * API never hands out a raw row.
 */

import {
  insertSubmission, pruneSubmissions, listNewest, listOldest, getSubmission, summaryByOutcome,
} from "../db/gen/querier.js";
import { ENGINE_VERSION } from "./version.js";
import { RENDERED_FIELD } from "./turnstile.js";

/** The env binding the log lives in. One D1 database per site. */
export const STORE_BINDING = "FORM_DB";

/** The layout written by this engine. See CHANGING THE LAYOUT above. */
export const ROW_SCHEMA = 1;

/** Every value the outcome column can hold. */
export const OUTCOMES = ["sent", "send-failed", "invalid", "turnstile", "honeypot"];

// Header values are the visitor's to choose; cap what we keep of them.
const cap = (s, n = 512) => (s == null ? "" : String(s).slice(0, n));
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Build the row for one POST.
 *
 * @param {object} a
 * @param {object} a.form
 * @param {Request} a.request
 * @param {FormData|null} a.data       null when the body could not be read
 * @param {Date} a.receivedAt          when the POST arrived
 * @param {string} a.outcome           one of OUTCOMES
 * @param {number} a.status            the HTTP status the visitor got
 * @param {string} a.statusMessage
 * @param {Record<string,string>} [a.values]   stored only for sent/send-failed
 * @param {object|null} [a.turnstile]  verifyTurnstile's answer, if it ran
 * @param {boolean} [a.honeypot]
 */
export function buildRow({ form, request, data, receivedAt, outcome, status, statusMessage,
                           values = {}, turnstile = null, honeypot = false }) {
  if (!OUTCOMES.includes(outcome)) throw new Error(`unknown outcome "${outcome}"`);
  const keepAnswers = outcome === "sent" || outcome === "send-failed";
  return {
    uid: crypto.randomUUID(),
    form: form.id,
    url: request.url,
    timestamp: receivedAt.toISOString(),
    schemaVersion: ROW_SCHEMA,
    outcome,
    formMeta: JSON.stringify({
      id: form.id,
      version: form.version ?? "",
      engine: ENGINE_VERSION,
      fields: form.fields.map((f) => ({ name: f.name, type: f.type, required: Boolean(f.required) })),
    }),
    answers: JSON.stringify(keepAnswers ? values : {}),
    session: JSON.stringify(sessionMeta({ request, data, receivedAt, turnstile, honeypot })),
    workflow: JSON.stringify({
      events: [{ event: "submit", timestamp: new Date().toISOString(), status, statusMessage: cap(statusMessage, 300) }],
    }),
  };
}

function sessionMeta({ request, data, receivedAt, turnstile, honeypot }) {
  const cf = request.cf || {};
  const h = request.headers;
  // The page's render time, echoed back by a hidden field. The client can
  // alter it, so elapsedMs is a signal, not proof: a bot that posts 300 ms after
  // the page rendered is still worth noticing.
  const raw = data?.get(RENDERED_FIELD);
  const rendered = typeof raw === "string" ? Date.parse(raw) : NaN;
  return {
    userAgent: cap(h.get("user-agent")),
    acceptLanguage: cap(h.get("accept-language"), 128),
    referer: cap(h.get("referer")),
    embed: new URL(request.url).searchParams.get("embed") === "1",
    country: cf.country ?? null,
    asn: cf.asn ?? null,
    asOrganization: cf.asOrganization ?? null,
    colo: cf.colo ?? null,
    httpProtocol: cf.httpProtocol ?? null,
    tlsVersion: cf.tlsVersion ?? null,
    honeypot,
    turnstile: turnstile && {
      success: turnstile.ok,
      reason: turnstile.reason ?? "",
      hostname: turnstile.result?.hostname ?? null,
      challengeTs: turnstile.result?.challenge_ts ?? null,
      action: turnstile.result?.action ?? null,
      errorCodes: turnstile.result?.["error-codes"] ?? [],
    },
    renderedAt: Number.isNaN(rendered) ? null : new Date(rendered).toISOString(),
    elapsedMs: Number.isNaN(rendered) ? null : receivedAt.getTime() - rendered,
  };
}

/**
 * Write one row, and prune the form's old rows if form.retainDays is set.
 * One batch: one round trip, and the pair is atomic.
 */
export async function logSubmission(db, form, row) {
  const statements = [insertSubmission(db, row).batch()];
  if (form.retainDays) {
    const before = new Date(Date.now() - form.retainDays * DAY_MS).toISOString();
    statements.push(pruneSubmissions(db, { form: form.id, timestamp: before }).batch());
  }
  await db.batch(statements);
}

/**
 * A stored row -> the public record. The ONLY way a row leaves the Worker: the
 * API speaks this shape, never column names, so the table can change under it.
 */
export function toRecord(row) {
  switch (row.schemaVersion) {
    // case 2: a future layout gets its own branch here, mapped to the same shape.
    case 1:
    default:
      return {
        id: row.uid,
        form: row.form,
        url: row.url,
        timestamp: row.timestamp,
        schemaVersion: row.schemaVersion,
        outcome: row.outcome,
        formMeta: JSON.parse(row.formMeta),
        answers: JSON.parse(row.answers),
        session: JSON.parse(row.session),
        workflow: JSON.parse(row.workflow),
      };
  }
}

// ── reads, in the reader's terms ───────────────────────────────────────────────

const LAST_TIME = "9999-12-31T23:59:59.999Z";

/**
 * A page of records. `after` is the internal id the previous page ended on (from
 * a cursor); `from` is where the listing starts in time.
 *
 * @returns {Promise<{records: object[], lastId: number|null, more: boolean}>}
 */
export async function listRecords(db, { form, order, outcome, from, after, limit }) {
  const like = outcome === "all" ? "%" : outcome;
  const args = { form, outcome: like, limit: limit + 1 };
  const { results = [] } = order === "oldest"
    ? await listOldest(db, { ...args, timestamp: from ?? "", id: after ?? 0 })
    : await listNewest(db, { ...args, timestamp: from ?? LAST_TIME, id: after ?? Number.MAX_SAFE_INTEGER });
  const more = results.length > limit;
  const page = results.slice(0, limit);
  return { records: page.map(toRecord), lastId: page.length ? page[page.length - 1].id : null, more };
}

export async function getRecord(db, form, uid) {
  const row = await getSubmission(db, { form, uid });
  return row ? toRecord(row) : null;
}

/** Counts plus first and latest timestamps, overall and per outcome. */
export async function summarise(db, form) {
  const { results = [] } = await summaryByOutcome(db, { form });
  const byOutcome = {};
  let total = 0, first = null, latest = null;
  for (const r of results) {
    byOutcome[r.outcome] = { count: r.total, first: r.firstAt, latest: r.latestAt };
    total += r.total;
    if (first === null || r.firstAt < first) first = r.firstAt;
    if (latest === null || r.latestAt > latest) latest = r.latestAt;
  }
  return { form, total, first, latest, byOutcome };
}
