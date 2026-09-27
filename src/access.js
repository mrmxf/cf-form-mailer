/**
 * Cloudflare Access, checked by the Worker itself.
 *
 * The reader API returns names, email addresses and phone numbers, so it sits
 * behind a Cloudflare Access application. Access at the edge is the first lock;
 * this is the second. Verifying the JWT here means a mistake in the Access
 * policy - a path it forgot to cover, an app switched off - fails closed instead
 * of publishing every submission.
 *
 * Access adds `Cf-Access-Jwt-Assertion` to each request it lets through: an
 * RS256 JWT signed by the team's keys at <team>/cdn-cgi/access/certs. We check
 * the signature, the issuer, that our application's AUD tag is in `aud`, and
 * the time window. WebCrypto only: no dependencies.
 *
 *   ACCESS_TEAM_DOMAIN  e.g. https://myteam.cloudflareaccess.com
 *   ACCESS_AUD          the Access application's "Application Audience (AUD) Tag"
 *
 * Neither is a secret: the AUD tag only identifies the app, and cannot mint a
 * token.
 */

const CERTS_TTL_MS = 60 * 60 * 1000;   // keys rotate every six weeks; an hour is plenty
const REFETCH_MIN_MS = 60 * 1000;      // an unknown kid refetches, but not on every request
const SKEW_S = 60;                     // clock tolerance on nbf / iat

let cache = { team: "", at: 0, keys: new Map() };

/** Is the reader API usable with this env? */
export function readerConfigured(env) {
  return Boolean(env.FORM_DB && env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);
}

/**
 * `wrangler dev` has no Access in front of it. The bypass needs BOTH a dry run
 * AND a localhost URL: a deploy forces DRY_RUN=false, and a request reaching a
 * Worker through a Cloudflare route never carries a localhost host.
 */
export function isLocalDev(request, env) {
  const host = new URL(request.url).hostname;
  return env.DRY_RUN === "true" && (host === "localhost" || host === "127.0.0.1" || host === "[::1]");
}

const teamOrigin = (d) => new URL(/^https?:\/\//.test(d) ? d : `https://${d}`).origin;

function b64urlBytes(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

async function signingKey(team, kid) {
  const now = Date.now();
  const stale = cache.team !== team || now - cache.at > CERTS_TTL_MS;
  const unknown = !cache.keys.has(kid) && now - cache.at > REFETCH_MIN_MS;
  if (stale || unknown) {
    const res = await fetch(`${team}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error(`certs ${res.status}`);
    const { keys = [] } = await res.json();
    const map = new Map();
    for (const jwk of keys) {
      if (jwk.kty !== "RSA" || !jwk.kid) continue;
      map.set(jwk.kid, await crypto.subtle.importKey(
        "jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
    }
    cache = { team, at: now, keys: map };
  }
  return cache.keys.get(kid) ?? null;
}

/**
 * @returns {Promise<{ok: true, email: string} | {ok: false, reason: string}>}
 */
export async function verifyAccess(request, env) {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return { ok: false, reason: "no-access-token" };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed-token" };
  let header, payload;
  try {
    header = b64urlJson(parts[0]);
    payload = b64urlJson(parts[1]);
  } catch {
    return { ok: false, reason: "malformed-token" };
  }
  // Pin the algorithm: never let the token choose how it is checked.
  if (header.alg !== "RS256" || !header.kid) return { ok: false, reason: "bad-algorithm" };

  let team;
  try { team = teamOrigin(env.ACCESS_TEAM_DOMAIN); } catch { return { ok: false, reason: "bad-team-domain" }; }

  let key;
  try { key = await signingKey(team, header.kid); } catch (err) {
    return { ok: false, reason: `certs-unavailable: ${err.message}` };
  }
  if (!key) return { ok: false, reason: "unknown-key" };

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  let valid = false;
  try { valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]), signed); } catch { /* invalid */ }
  if (!valid) return { ok: false, reason: "bad-signature" };

  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== team) return { ok: false, reason: "wrong-issuer" };
  if (!aud.includes(env.ACCESS_AUD)) return { ok: false, reason: "wrong-audience" };
  if (typeof payload.exp !== "number" || payload.exp <= now) return { ok: false, reason: "expired" };
  if (typeof payload.nbf === "number" && payload.nbf > now + SKEW_S) return { ok: false, reason: "not-yet-valid" };

  return { ok: true, email: payload.email || payload.common_name || "" };
}

/** Tests only: forget cached keys. */
export function resetAccessCache() {
  cache = { team: "", at: 0, keys: new Map() };
}
