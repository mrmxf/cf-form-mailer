/**
 * Sending the notification email, via Mailtrap's HTTP Sending API.
 *
 * ── WHY HTTP AND NOT SMTP ──────────────────────────────────────────────────────
 * Cloudflare Workers block outbound port 25. Port 2525 is reachable through
 * `cloudflare:sockets`, but using it would mean hand-rolling SMTP + STARTTLS +
 * AUTH with no maintained Workers client. The HTTP API is the same service, the
 * same account and the same deliverability, and it is a plain `fetch`.
 *
 * ── WHY NOT cloudflare:email ───────────────────────────────────────────────────
 * The previous version of this file used Cloudflare's native `send_email`
 * binding. That binding can only deliver to an address pre-verified as a
 * Destination Address in Email Routing, which is why the old README said the
 * form "cannot send a confirmation copy to the applicant". With Mailtrap that
 * restriction does not exist: the recipient is ordinary configuration, and a
 * confirmation copy is now possible if someone wants to add one.
 *
 * Cloudflare Email Routing is still in use — it is the RECEIVE path, handled by
 * a separate custom Worker. Nothing here touches it.
 *
 * ── WHY mimetext IS GONE ───────────────────────────────────────────────────────
 * The HTTP API takes JSON, not a MIME blob, so the dependency (and its
 * "mimetext/browser, not mimetext" bundling trap) is no longer needed.
 *
 * That removal costs us one thing we must put back by hand: mimetext's `Mailbox`
 * type base64-encoded display names, which is what stopped a submitter called
 * `Jane\r\nBcc: attacker@evil.com` from injecting mail headers. `subject`,
 * `from.name` and `Reply-To` still end up in headers, so headerSafe() below is
 * now the ONLY thing preventing that. Do not remove it.
 */

const MAILTRAP_URL = "https://send.api.mailtrap.io/api/send";

/**
 * Strip anything that could terminate a header line.
 *
 * JSON encoding alone is not enough: it escapes the newline in transit, but
 * Mailtrap then writes the decoded value into an actual header.
 */
export function headerSafe(s) {
  return String(s ?? "").replace(/[\r\n]+/g, " ").trim();
}

/**
 * A value is "not configured" if it is missing or still a TODO placeholder.
 *
 * wrangler.jsonc ships `TODO-before-go-live` rather than a guess, so that a
 * wrong address can never be mistaken for a real one. Without this check a
 * truthy placeholder would report as configured on /health and the form would
 * cheerfully mail nowhere.
 */
export function isConfigured(value) {
  return Boolean(value) && !String(value).startsWith("TODO");
}

/**
 * Format a display name + address for an address header.
 *
 * The display name is quoted and its quotes/backslashes escaped. headerSafe()
 * has already removed CR/LF, but a name like `Jane Bcc: x@y.com` still contains
 * characters that are only legal inside a quoted string — leaving it bare
 * invites a lenient parser to read it as structure rather than text.
 */
function addressHeader(name, addr) {
  const safeName = name.replace(/([\\"])/g, "\\$1");
  return `"${safeName}" <${addr}>`;
}

/**
 * Build the plain-text body from the form's own field list, so a new question
 * appears in the email automatically.
 */
function buildBody(form, values, meta) {
  const lines = form.fields.map((f) => {
    const raw = values[f.name];
    let shown = raw || "(not given)";
    if (f.options && raw) {
      shown = f.options.find((o) => o.value === raw)?.label ?? raw;
    }
    // "Are you a Blue Badge holder?: Yes" reads badly — drop a trailing question
    // mark before appending the colon.
    return `${f.label.replace(/\?$/, "")}: ${shown}`;
  });

  return [
    form.copy.emailIntro,
    "",
    ...lines,
    "",
    "---",
    `Submitted: ${meta.submittedAt}`,
    `From IP:   ${meta.ip || "unknown"}`,
    `Country:   ${meta.country || "unknown"}`,
    "",
    "Reply directly to this email to reach the sender.",
    `Sent by the ${form.id} form (cf-form-mailer).`,
  ].join("\n");
}

/**
 * @param {object} args
 * @param {object} args.form    The form definition (id, fields, copy, subject).
 * @param {Record<string,string>} args.values  Validated values.
 * @param {object} args.env     Worker env.
 * @param {object} args.meta    { submittedAt, ip, country }
 * @returns {Promise<{sent: boolean, dryRun: boolean}>}
 */
export async function sendFormEmail({ form, values, env, meta }) {
  const recipient = headerSafe(env[form.recipientVar]);
  const sender = headerSafe(env[form.senderVar]);
  const eventName = env.SITE_NAME || form.site.name;

  const replyName = headerSafe(values[form.replyNameField]) || "Unknown sender";
  const replyAddr = headerSafe(values[form.replyEmailField]);

  const subject = headerSafe(form.subject(values));
  const text = buildBody(form, values, meta);

  const payload = {
    from: { email: sender, name: `${eventName} ${form.id} form` },
    to: [{ email: recipient }],
    subject,
    text,
    // Mailtrap passes custom headers straight through. This is why the email
    // field is required: without it a submission is a dead end.
    headers: { "Reply-To": addressHeader(replyName, replyAddr) },
  };

  // wrangler dev has no outbound credentials, so local development would be
  // impossible without this. It also makes the message inspectable, which is the
  // fastest way to check a change to buildBody().
  if (env.DRY_RUN === "true" || !env.MAILTRAP_API_TOKEN) {
    const why = env.DRY_RUN === "true" ? "DRY_RUN=true" : "no MAILTRAP_API_TOKEN";
    console.log(
      `\n===== DRY RUN (${why}) — email NOT sent =====\n` +
      `To:         ${recipient}\nFrom:       ${sender}\n` +
      `Reply-To:   ${payload.headers["Reply-To"]}\nSubject:    ${subject}\n\n${text}\n` +
      `===== end of message =====\n`
    );
    return { sent: false, dryRun: true };
  }

  if (!isConfigured(recipient)) {
    // Fail closed. A send with no real recipient must not look like a success.
    throw new Error(`${form.recipientVar} is not configured (got ${recipient || "empty"}) — refusing to send`);
  }
  if (!isConfigured(sender)) {
    throw new Error(`${form.senderVar} is not configured (got ${sender || "empty"}) — refusing to send`);
  }

  const res = await fetch(MAILTRAP_URL, {
    method: "POST",
    headers: {
      "Api-Token": env.MAILTRAP_API_TOKEN,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`mailtrap ${res.status}: ${detail.slice(0, 300)}`);
  }

  return { sent: true, dryRun: false };
}
