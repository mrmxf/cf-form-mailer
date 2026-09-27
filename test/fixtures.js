/**
 * A minimal site and form for the store and reader tests. Tests only.
 */
export const tokens = (c) => ({
  "primary": c, "primary-hover": c, "on-primary": c, "error": c, "error-bg": c,
  "bg": c, "surface": c, "body": c, "meta": c, "link": c, "border": c,
});
export const SITE = {
  name: "Test Site", url: "https://example.test", lang: "en-GB",
  fonts: { href: "", body: "sans-serif", heading: "serif" },
  theme: { light: tokens("#fff"), dark: tokens("#000") },
};
export const FIELDS = [
  { name: "name", label: "Your name", type: "text", required: true, maxLength: 20 },
  { name: "email", label: "Email address", type: "email", required: true, maxLength: 254 },
  { name: "message", label: "Your message", type: "textarea", required: true, maxLength: 200 },
];
export const FORM = {
  id: "contact", version: "3", site: SITE, fields: FIELDS,
  copy: { title: "Contact", heading: "Contact", submit: "Send", intro: "", successTitle: "Sent",
    successBody: "<p>ok</p>", emailIntro: "A message." },
  senderVar: "CONTACT_SENDER", recipientVar: "CONTACT_RECIPIENT",
  replyNameField: "name", replyEmailField: "email",
  subject: (v) => `contact: ${v.name}`,
};
export const ENV = { TURNSTILE_SITE_KEY: "k", DRY_RUN: "true",
  CONTACT_SENDER: "no-reply@example.test", CONTACT_RECIPIENT: "to@example.test" };
export const VALID = { name: "Jane", email: "j@x.test", message: "hello", "cf-turnstile-response": "tok" };

export const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
