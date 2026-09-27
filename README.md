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
| A submission log | Optional: bind a D1 database and every POST leaves one row, whatever happened to it. |
| A reader API | `/api/v1/*` lets staff pages list and count submissions, behind Cloudflare Access. |

## Requirements

- Node 22+ and [wrangler][wrangler] (a dev dependency of your Worker project)
- A Cloudflare account, and a Turnstile widget for your domain
- A Mailtrap account with your sending domain verified

## Install

```bash
npm install "github:mrmxf/cf-form-mailer#1.3.0"
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

Route it at `/forms/<name>*`, NOT at the page people visit. The recommended shape is a
page of your own — with your navigation, your header and your footer — that embeds the
form: see [Embed it in your site](#embed-it-in-your-site). Putting the Worker on
`/contact*` works, but then the Worker IS that page, and it has only its own plain
header and footer.

```jsonc
{
  "name": "example-form-contact",
  "main": "src/index.js",
  "compatibility_date": "2025-11-01",
  "routes": [
    { "pattern": "example.org/forms/contact*", "zone_name": "example.org" },
    { "pattern": "staging.example.org/forms/contact*", "zone_name": "example.org" }
  ],
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
| `ADMIN_URL_<NAME>` | var | optional: a staff admin link, added to the email as an `Admin:` line. Unset = no line. The name is yours: `adminUrlVar` |
| `TURNSTILE_SITE_KEY` | var | public, ships in the page HTML |
| `TURNSTILE_SECRET_KEY` | **secret** | `wrangler secret put` |
| `MAILTRAP_API_TOKEN` | **secret** | `wrangler secret put` |
| `DRY_RUN` | var | `"true"` prints the email instead of sending it |
| `SITE_NAME` | var | optional, overrides `site.name` |
| `FORM_DB` | D1 binding | optional: turns on the [submission log](#submission-log-d1) |
| `ACCESS_TEAM_DOMAIN` | var | the [reader API](#reader-api)'s Access team, e.g. `https://myteam.cloudflareaccess.com` |
| `ACCESS_AUD` | var | the Access application's AUD tag. Not a secret: it identifies the app, it cannot mint a token |

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

## Embed it in your site

**This is the recommended way to use the form.** The visitor stays on your page, with
your navigation and footer; the Worker supplies only the form itself. `?embed=1` renders
it without its own header, h1 and footer.

Copy the file for your generator from [`examples/`](examples/), plus
[`examples/css/form-frame.css`](examples/css/form-frame.css). Each one is an iframe, a
script that sizes it to its contents, and a visible link to the form's own page for when
the frame cannot load.

**Any HTML page** — [`examples/html/form-frame.html`](examples/html/form-frame.html):

```html
<div class="form-frame-wrap">
  <iframe class="form-frame" src="/forms/contact/?embed=1" title="Contact form"></iframe>
  <p class="form-frame-alt">Form not showing? <a href="/forms/contact/">Open the form on its own page</a>.</p>
</div>
<script>/* the sizing script — see the example file */</script>
```

**Hugo** — save [`examples/hugo/form-frame.html`](examples/hugo/form-frame.html) as
`layouts/_shortcodes/form-frame.html`, then in any page:

```go-html-template
{{< form-frame src="/forms/contact/" title="Contact form" >}}
```

It emits the script once per page, and `errorf`s on a missing `src` or `title`, so a
mistake fails the build rather than shipping an unlabelled frame.

**Jekyll** — save [`examples/jekyll/form-frame.html`](examples/jekyll/form-frame.html)
as `_includes/form-frame.html`, then in any page or post:

```liquid
{% include form-frame.html src="/forms/contact/" title="Contact form" %}
```

Liquid cannot fail a build, so a missing parameter leaves an HTML comment and renders
nothing — check the output if the form does not appear.

### What makes the sizing work

- The Worker must be **same-origin** with the page: routed on your own domain, not
  `*.workers.dev`. Cross-origin, the script cannot read the frame, fails quietly, and the
  CSS `min-height` stands — which is also what happens under `hugo server` and
  `jekyll serve`, where the route does not exist.
- The page sets `<base target="_parent">` in embed mode, so links inside the form open in
  your page, while the form itself carries `target="_self"` so a submit stays in the
  frame. Both are handled here; do not override them.
- The form posts back to `?embed=1`, so validation errors and the thank-you page stay
  embedded, and the script scrolls the result into view.
- `frame-ancestors 'self'` means only your own site can frame the form.

## Submission log (D1)

Bind a D1 database as `FORM_DB` and every POST writes one row — sent, failed, invalid,
rejected by Turnstile or caught by the honeypot. Without the binding nothing changes.

**One database per site**, shared by all its forms: each row carries its form's `id`, and
each form's Worker only ever reads its own. The schema ships inside this package, so
point `migrations_dir` at it and a version bump brings its migrations with it:

```jsonc
"d1_databases": [{
  "binding": "FORM_DB",
  "database_name": "example-forms",           // npx wrangler d1 create example-forms
  "database_id": "<from wrangler d1 create>",
  "migrations_dir": "../node_modules/@mrmxf/cf-form-mailer/db/migrations"
}]
```

```bash
npx wrangler d1 migrations apply FORM_DB --local    # before wrangler dev
npx wrangler d1 migrations apply FORM_DB --remote   # before every deploy
```

Two optional keys on the form definition:

| key | |
|---|---|
| `version` | a string of your own, recorded with each row, e.g. `"2"` after you change the questions |
| `retainDays` | delete this form's rows older than this many days, on each insert. Default: keep everything |

What a row holds:

| | |
|---|---|
| `url`, `timestamp` | where it was posted, and when (ISO 8601, UTC) |
| `outcome` | `sent`, `send-failed`, `invalid`, `turnstile` or `honeypot` |
| form metadata | the form's `id` and `version`, the engine version, and the field list |
| answers | the submitted values — **only for `sent` and `send-failed`** |
| session | user agent, language, referrer, embed, country, ASN, colo, the Turnstile verdict, and how long after the page rendered it was submitted |
| workflow | `{"events":[{"event":"submit","timestamp":…,"status":200,"statusMessage":""}]}` |

**No IP address is stored, anywhere.** The email still shows it; the database does not.

**The log never changes what the visitor sees.** It is written after the outcome is
known; if D1 fails, the error is logged and the visitor still gets the page they would
have got. By then the email has gone, and an error would only make them send it again.

## Reader API

For staff pages. Every response is JSON, `cache-control: no-store`, and GET only.

| | |
|---|---|
| `GET /api/v1/submissions` | `{items, next}`, newest first. `limit` (1–100, default 10), `order` (`newest`/`oldest`), `from` (ISO date or date-time: at or before it for newest, at or after for oldest), `outcome` (default `sent`; `all` or any outcome), `cursor` (the previous page's `next`) |
| `GET /api/v1/submissions/<id>` | one record |
| `GET /api/v1/summary` | `{form, total, first, latest, byOutcome}` — counts and the first and latest timestamps |

A record is `{id, form, url, timestamp, schemaVersion, outcome, formMeta, answers,
session, workflow}`. The API never exposes the table: it is versioned (`/v1`) separately
from the row layout, and old rows are translated as the layout changes.

**It is protected by Cloudflare Access, twice.** Put an Access application in front of
`/forms/*/api/*` *and* in front of the pages that call it — a page outside Access gets a
cross-origin login redirect instead of data. The Worker then checks the Access JWT
itself (signature, issuer, `ACCESS_AUD`, expiry), so a gap in the Access policy fails
closed instead of publishing every submission:

- no `FORM_DB` → `503 store-not-configured`
- no `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` → `503 reader-not-configured`
- no valid token → `403 forbidden`

Under `wrangler dev` there is no Access, so the check is skipped when — and only when —
`DRY_RUN` is `"true"` **and** the host is `localhost`.

## Routes

| | |
|---|---|
| `GET /` | the form |
| `POST /` | honeypot → Turnstile → validate → email → thank you |
| `GET /health` | JSON: `dryRun`, `mailtrapConfigured`, `senderConfigured`, `recipientConfigured`, `turnstileConfigured`, `storeConfigured`, `readerConfigured` |
| `GET /api/v1/*` | the [reader API](#reader-api) |
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
- **A failed D1 write never changes the response.** The email has already gone.
- **The reader API refuses** without D1, without Access configuration, or without a
  valid Access token.

## Changing the SQL

`db/migrations/` is both the D1 migrations and the [sqlc][sqlc] schema; `db/query.sql`
is every query. `clog sqlc` regenerates `db/gen/` with the `sqlc-gen-ts-d1` plugin, then
strips the types into `db/gen/querier.js`, which is what the engine imports — it stays
plain JS with no build step. All of it is committed, so only people changing SQL need
sqlc.

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
[sqlc]: https://sqlc.dev/
