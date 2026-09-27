/**
 * The reader API: submissions for staff pages, in their terms, not the table's.
 *
 *   GET <base>/api/v1/submissions   ?limit ?order ?from ?outcome ?cursor
 *   GET <base>/api/v1/submissions/<id>
 *   GET <base>/api/v1/summary       counts, first and latest timestamps
 *
 * <base> is wherever the Worker is routed, e.g. /forms/parking. Each form's
 * Worker answers for its own form only.
 *
 * Every response is a record from toRecord() or built from one - never a raw
 * row - and /v1 is versioned independently of the row's schema_version.
 *
 * Fails closed, in this order: no D1 -> 503; no Access configuration -> 503;
 * no valid Access JWT -> 403. The last two are skipped only for `wrangler dev`
 * (isLocalDev in access.js).
 */

import { listRecords, getRecord, summarise, OUTCOMES } from "./store.js";
import { readerConfigured, verifyAccess, isLocalDev } from "./access.js";

export const API_PREFIX = "/api/v1";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
const fail = (status, error, detail) => json(detail ? { error, detail } : { error }, status);

const MAX_LIMIT = 100;

// The cursor names the last row of the previous page. base64url JSON, so that
// clients treat it as opaque rather than doing arithmetic on ids.
const encodeCursor = (order, id) =>
  btoa(JSON.stringify({ o: order, id })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function decodeCursor(s, order) {
  try {
    const c = JSON.parse(atob(s.replace(/-/g, "+").replace(/_/g, "/")));
    if (c.o === order && Number.isSafeInteger(c.id) && c.id >= 0) return c.id;
  } catch { /* fall through */ }
  return null;
}

/**
 * @param {string} rest  the path after API_PREFIX, e.g. "/summary"
 */
export async function handleReader({ request, env, form, rest }) {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET" } });
  }
  const db = env.FORM_DB;
  if (!db) return fail(503, "store-not-configured");

  if (!isLocalDev(request, env)) {
    if (!readerConfigured(env)) return fail(503, "reader-not-configured");
    const who = await verifyAccess(request, env);
    if (!who.ok) {
      console.log(`[${form.id}] reader refused: ${who.reason}`);
      return fail(403, "forbidden");
    }
    console.log(`[${form.id}] reader: ${who.email || "(no email)"} GET ${API_PREFIX}${rest}`);
  }

  const url = new URL(request.url);
  if (rest === "/summary") return json(await summarise(db, form.id));
  if (rest === "/submissions") return list(db, form, url.searchParams);
  const one = rest.match(/^\/submissions\/([0-9a-f-]{36})$/);
  if (one) {
    const record = await getRecord(db, form.id, one[1]);
    return record ? json(record) : fail(404, "not-found");
  }
  return fail(404, "not-found");
}

async function list(db, form, q) {
  const limitRaw = q.get("limit") ?? "10";
  const limit = Number(limitRaw);
  if (!/^\d+$/.test(limitRaw) || limit < 1 || limit > MAX_LIMIT) {
    return fail(400, "bad-limit", `limit is a whole number from 1 to ${MAX_LIMIT}`);
  }

  const order = q.get("order") ?? "newest";
  if (order !== "newest" && order !== "oldest") return fail(400, "bad-order", "order is newest or oldest");

  const outcome = q.get("outcome") ?? "sent";
  if (outcome !== "all" && !OUTCOMES.includes(outcome)) {
    return fail(400, "bad-outcome", `outcome is all or one of ${OUTCOMES.join(", ")}`);
  }

  // newest: at or before `from`; oldest: at or after it.
  let from;
  if (q.has("from")) {
    const t = Date.parse(q.get("from"));
    if (Number.isNaN(t)) return fail(400, "bad-from", "from is an ISO 8601 date or date-time");
    from = new Date(t).toISOString();
  }

  let after;
  if (q.has("cursor")) {
    after = decodeCursor(q.get("cursor"), order);
    if (after === null) return fail(400, "bad-cursor", "cursor must come from a previous page with the same order");
  }

  const page = await listRecords(db, { form: form.id, order, outcome, from, after, limit });
  return json({
    items: page.records,
    next: page.more ? encodeCursor(order, page.lastId) : null,
  });
}
