# cf-form-mailer

A contact form that runs as a [Cloudflare Worker][workers]: it serves the HTML page,
validates what people type, keeps the bots out, and emails the result. You write the
questions; everything else is here.

```js
// src/index.js — the whole Worker
import { createHandler } from "@mrmxf/cf-form-mailer";
import { SITE } from "../site.js";
import { FIELDS } from "./fields.js";
import { COPY } from "./copy.js";

export default createHandler({
  id: "contact",
  site: SITE,
  fields: FIELDS,
  copy: COPY,
  senderVar: "CONTACT_SENDER",
  recipientVar: "CONTACT_RECIPIENT",
  replyNameField: "name",
  replyEmailField: "email",
  subject: (v) => `Website contact: ${v.subject}`,
});
```

**To add, remove, reword or reorder a question, edit `fields.js` and nothing else.** The
page, the validation and the email all follow, because they read the same array.

Used by [mrmxf.com](https://mrmxf.com) and
[chiddingfoldbonfire.uk](https://chiddingfoldbonfire.uk).

## What you get

| | |
|---|---|
| A page | One self-contained HTML page, styled from your colour tokens. No framework, no build step, no CSS to serve. |
| Validation | Required, max length, email shape, radio options. Errors come back **with the visitor's answers still in the boxes**. |
| Spam defence | A honeypot, plus [Turnstile][turnstile]. |
| Email | Sent through [Mailtrap's][mailtrap] HTTP API, with `Reply-To` set to the sender so you just hit reply. |
| An embed mode | `?embed=1` renders without header or footer, for an iframe in your site's own page. |
| A health page | `/health` reports what is configured, so a bad deploy is obvious. |

## Requirements

- Node 22+ and [wrangler][wrangler] (a dev dependency of your Worker project)
- A Cloudflare account, and a Turnstile widget for your domain
- A Mailtrap account with your sending domain verified

## Install

```bash
npm install "github:mrmxf/cf-form-mailer#1.0.0"
```

Pin the tag. Tags carry no leading `v`. wrangler bundles the package, so there is
nothing to build or publish.

## Your Worker, file by file

```
cf_tools/
├── site.js              the site: name, URL, fonts, colours. Shared by every form.
├── package.json         depends on this package + wrangler
└── form-contact/
    ├── wrangler.jsonc   name, route, vars
    └── src/
        ├── fields.js    the questions          ← the file you will actually edit
        ├── copy.js      every word a visitor reads
        └── index.js     the ten lines above
```

### `site.js` — one per site

Colours are given as tokens, so the form matches the site without loading its stylesheet.
Give `light` and `dark` and the page follows the visitor's `prefers-color-scheme`; give
only one and it is fixed to that.

```js
export const SITE = {
  name: "Example Org",              // shown on the page and in the email
  url: "https://example.org",       // absolute, used in the footer link
  lang: "en-GB",                    // optional, defaults to en-GB
  fonts: {
    href: "",                       // a Google Fonts css2 URL, or "" for none
    body: "system-ui, Arial, sans-serif",
    heading: "system-ui, Arial, sans-serif",
  },
  theme: {
    light: {
      "primary": "#433f87",         // buttons and the page banner
      "primary-hover": "#34316a",
      "on-primary": "#ffffff",      // text ON primary
      "error": "#b3261e",
      "error-bg": "#fdecea",        // the error summary panel
      "bg": "#ffffff",
      "surface": "#f6f6f8",         // input backgrounds, the thank-you panel
      "body": "#1a1a1a",            // body text
      "meta": "#555555",            // hints, footer
      "link": "#9a3a72",            // links and the focus ring
      "border": "#8a8a99",          // input borders
    },
    dark: { /* the same eleven tokens */ },
  },
};
```

All eleven tokens are required in each block you supply; a missing one is an error at
deploy. **Check the contrast when you change a colour, do not eyeball it**: text on its
background needs 4.5:1, borders 3:1.

### `fields.js` — the questions

```js
export const FIELDS = [
  { name: "name",  label: "Your name",     type: "text",     required: true, maxLength: 100, autocomplete: "name" },
  { name: "email", label: "Email address", type: "email",    required: true, maxLength: 254,
    hint: "We reply to this address, so please check it carefully." },
  { name: "message", label: "Your message", type: "textarea", required: true, maxLength: 4000 },
];
```

| key | |
|---|---|
| `name` | form field name, and the key in `values`. Unique. |
| `label` | shown on the page and used in the email body |
| `type` | `text`, `email`, `tel`, `textarea`, `radio` |
| `required` | `false` adds "(optional)" to the label |
| `maxLength` | enforced in the browser and again on the server |
| `hint` | small print under the label, wired up with `aria-describedby` |
| `placeholder`, `autocomplete` | passed through to the input |
| `options` | `[{value, label}]` — required for `radio`, and validated |
| `transform` | `"upper"` upper-cases the answer (car registrations, postcodes) |

`textarea` keeps its line breaks; every other type collapses whitespace.

### `copy.js` — the wording

```js
export const COPY = {
  title: "Contact",                 // <title>
  heading: "Contact us",            // the page banner
  submit: "Send message",           // the button
  intro: `Raw HTML, authored by you.`,
  embedIntro: `Optional: replaces intro when embedded with ?embed=1.`,
  successTitle: "Message sent",
  successBody: `<p>Raw HTML for the thank-you page.</p>`,
  emailIntro: "A message has been sent through the website contact form.",
};
```

### `wrangler.jsonc`

Route the Worker on your own domain, so the form is same-origin with the site and needs
no CORS. Worker routes match before Pages or any other origin.

```jsonc
{
  "name": "example-form-contact",
  "main": "src/index.js",
  "compatibility_date": "2025-11-01",
  "routes": [{ "pattern": "example.org/forms/contact*", "zone_name": "example.org" }],
  "vars": {
    "TURNSTILE_SITE_KEY": "1x00000000000000000000AA",  // the test key; the real one is set at deploy
    "DRY_RUN": "false"
  },
  "observability": { "enabled": true }
}
```

## Environment

| name | kind | |
|---|---|---|
| `<NAME>_SENDER` | var | `From:` — a Mailtrap-verified address. The name is yours: `senderVar` |
| `<NAME>_RECIPIENT` | var | `To:` — where messages land. `recipientVar` |
| `TURNSTILE_SITE_KEY` | var | public, ships in the page HTML |
| `TURNSTILE_SECRET_KEY` | **secret** | `wrangler secret put` |
| `MAILTRAP_API_TOKEN` | **secret** | `wrangler secret put` |
| `DRY_RUN` | var | `"true"` prints the email instead of sending it |
| `SITE_NAME` | var | optional, overrides `site.name` |

## Run it locally

No account, no secrets, nothing sent to anyone:

```bash
npx wrangler dev \
  --var DRY_RUN:true \
  --var CONTACT_SENDER:no-reply@example.org \
  --var CONTACT_RECIPIENT:you@example.org \
  --var TURNSTILE_SITE_KEY:1x00000000000000000000AA \
  --var TURNSTILE_SECRET_KEY:1x0000000000000000000000000000000AA
```

Open <http://localhost:8787>, submit, and the whole email appears in your terminal. Those
Turnstile keys are Cloudflare's [published test keys][testkeys] that always pass — they
are documented public values, not secrets.

## Deploy

```bash
printf '%s' "$TURNSTILE_SECRET_KEY" | npx wrangler secret put TURNSTILE_SECRET_KEY
printf '%s' "$MAILTRAP_API_TOKEN"   | npx wrangler secret put MAILTRAP_API_TOKEN
npx wrangler deploy \
  --var DRY_RUN:false \
  --var TURNSTILE_SITE_KEY:"$TURNSTILE_SITE_KEY" \
  --var CONTACT_SENDER:"$CONTACT_SENDER" \
  --var CONTACT_RECIPIENT:"$CONTACT_RECIPIENT"
```

Then check `curl https://example.org/forms/contact/health`: everything `true` and
`dryRun` `false`. **If `dryRun` is true on a live deploy, nobody is receiving anything.**
Send yourself a real message and confirm the reply address works.

Ship the real `TURNSTILE_SITE_KEY`. Deployed with the test key, the spam check passes
every bot.

## Routes

| | |
|---|---|
| `GET /` | the form |
| `POST /` | honeypot → Turnstile → validate → email → thank you |
| `GET /health` | JSON: `dryRun`, `mailtrapConfigured`, `senderConfigured`, `recipientConfigured`, `turnstileConfigured` |
| `?embed=1` | on either verb: no header or footer, for an iframe |

Embedding: the iframe needs `<base target="_parent">` handling, which the page does for
you, and the page sets `frame-ancestors 'self'` so only your own site can frame it.

## How it behaves when things go wrong

These are deliberate. Please read before changing them.

- **A failed send never shows a thank-you page.** Someone who believes their message
  arrived will wait for a reply that never comes.
- **No Turnstile secret means every submission is refused**, not accepted unchecked.
- **A bot that trips the honeypot sees the normal thank-you page** and nothing is sent.
  An error would tell its author which field gave them away.
- **An unconfigured or `TODO` recipient refuses to send** rather than mailing nowhere.
- **A broken form definition throws when the Worker starts**, so `wrangler deploy` fails
  instead of a visitor finding out.

## Upgrading

```bash
npm install "github:mrmxf/cf-form-mailer#<tag>"
npm test    # in your own project
```

Breaking changes get a major version and a note in `releases.yaml`.

[workers]: https://developers.cloudflare.com/workers/
[turnstile]: https://developers.cloudflare.com/turnstile/
[testkeys]: https://developers.cloudflare.com/turnstile/troubleshooting/testing/
[mailtrap]: https://mailtrap.io/
[wrangler]: https://developers.cloudflare.com/workers/wrangler/
