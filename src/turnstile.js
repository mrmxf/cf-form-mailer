/**
 * Spam defences. Two layers, because they catch different things:
 *
 *   1. The honeypot catches dumb form-filling bots that never execute JavaScript.
 *      It costs nothing and needs no third-party service.
 *   2. Turnstile catches the ones that do run JavaScript.
 */

/**
 * The honeypot field name is shared by every form — it is a bot-facing detail,
 * not a per-form question, so it lives here rather than in each fields.js.
 */
export const HONEYPOT_FIELD = "address2";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Did a bot fill the hidden field?
 *
 * Note what the caller does with a `true` here: it shows the normal thank-you
 * page and sends nothing. Returning an error would tell the bot's author which
 * field gave them away, and they would simply skip it next time.
 */
export function trippedHoneypot(data) {
  const value = data.get(HONEYPOT_FIELD);
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Verify a Turnstile token with Cloudflare.
 *
 * @param {string} token   The cf-turnstile-response value from the form.
 * @param {string} secret  TURNSTILE_SECRET_KEY.
 * @param {string} [ip]    CF-Connecting-IP, if available.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function verifyTurnstile(token, secret, ip) {
  if (!secret) {
    // A missing secret must fail closed. Treating "unconfigured" as "verified"
    // would silently leave the form wide open for as long as nobody noticed.
    return { ok: false, reason: "turnstile-not-configured" };
  }
  if (!token) return { ok: false, reason: "missing-input-response" };

  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);

  let result;
  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body });
    result = await res.json();
  } catch (err) {
    return { ok: false, reason: `verify-request-failed: ${err.message}` };
  }

  if (result.success) return { ok: true };
  return { ok: false, reason: (result["error-codes"] || []).join(", ") || "rejected" };
}
