# AGENTS.md — cf-form-mailer

Instructions for any coding agent working in this repo. `CLAUDE.md` points here; keep
this file the only copy.

A Cloudflare Worker engine: one npm package, consumed by a site's `cf_tools/form-*/`
directory, which supplies only its questions, its wording and its `site.js`.

`npm test` is the only gate. There is no build and no type-check. It must pass before
any commit.

Usage, options and the deploy sequence are [README.md](README.md). Do not repeat them here.

## Layout

```
AGENTS.md       this file. CLAUDE.md is a pointer to it — never a second copy
index.js        the public entry point — every export goes through it
src/handler.js  the request flow, and assertForm (the definition guard)
src/render.js   the HTML page, TOKENS, the theme CSS
src/validate.js field-array-driven validation
src/turnstile.js honeypot + Turnstile verify
src/email.js    the body, the headers, the Mailtrap call
src/mailer.test.js  every promise the package makes
releases.yaml   version history, newest first. NOT a golang project: tags have no "v"
```

## Rules

### The package is site-agnostic
- A site name, URL, colour, font or address in `src/` is a bug. It comes from `form.site`
  (the consumer's `site.js`) or from `env`.
- Two sites consume this: `www-mrmxf-com/cf_tools/` and
  `www-chiddingfoldbonfire/cf_tools/`. A change here reaches every form on both.
- No runtime dependencies, ever. `dependencies` stays absent: this runs on the Workers
  runtime, so no Node APIs and no npm packages — `fetch`, `FormData`, `URL`, `Response`.
- No framework, no build step, no separate CSS file. The page is one template literal on
  purpose; a Worker that bundles a toolchain is not worth the bytes.

### Security — these are load-bearing
- `headerSafe()` and `addressHeader()` in `email.js` are the ONLY defence against
  mail-header injection. Mailtrap writes `subject`, `from.name` and `Reply-To` into real
  headers. Do not remove or "simplify" them.
- `esc()` every interpolated value in `render.js`. `copy.intro`, `copy.embedIntro` and
  `copy.successBody` are raw HTML BY DESIGN — they are authored, never submitted. Nothing
  from a request may join them unescaped.
- Fail closed, always: a missing Turnstile secret refuses the submission, an unconfigured
  or `TODO` recipient refuses to send, and a failed send returns an error page. A
  thank-you page means the email went.
- A tripped honeypot returns the ordinary thank-you page, never an error. An error tells
  the bot's author which field to skip next time.
- `frame-ancestors 'self'`: only the site itself may frame a form.
- The page must never log or echo a secret. Turnstile and Mailtrap tokens stay in `env`.

### Field array
- `render.js` and `validate.js` read the SAME `form.fields`. Never give either its own
  list, or a question reaches the page unvalidated — the usual way a form springs a leak.
- A new field `type` needs: a branch in `renderField`, its validation in `validate()`, and
  a test for both.

### The definition guard
- `assertForm` runs when the Worker module loads, so a broken definition fails
  `wrangler deploy` instead of a visitor's submit.
- Any new required key in a form or `site` object gets a check there and a case in the
  "rejects a definition that would break a live form" test.
- `TOKENS` in `render.js` is the theme contract. Adding one is a BREAKING change: every
  consumer's `site.js` must define it in each block it supplies.

### Theme
- `theme.light` + `theme.dark` follows `prefers-color-scheme`; one block alone is forced.
  Both paths are tested — keep them that way.
- Changing a default or example colour means recomputing contrast (4.5:1 text, 3:1
  borders). Do not eyeball it.

### Embed mode
- `?embed=1` drops `<header>`/`<footer>`, uses `copy.embedIntro` when present, and posts
  back to `?embed=1` so errors and the thank-you stay in the frame.
- `<base target="_parent">` needs the form's `target="_self"`. Remove one and a submit
  navigates the whole host page away.

### Email
- Mailtrap HTTP API, not SMTP: Workers block port 25.
- Cloudflare `send_email` is not an option — it only delivers to a pre-verified
  Destination Address. Email Routing is the RECEIVE side and is not this package.

### Tests
- `src/mailer.test.js` covers header injection, escaping, failing closed, the honeypot, a
  failed send, theming and the guard. A change to any of those behaviours changes a test —
  if none breaks, the test was too weak.
- No network in tests: stub `globalThis.fetch`. Addresses are `example.test`.

### Public repo
- No real addresses, keys, tokens or customer names in code, tests or docs.

### Releases
- A release is a row at the TOP of `releases.yaml` plus a matching git tag, no leading
  `v`. Consumers pin `github:mrmxf/cf-form-mailer#<tag>`, so an unreleased change reaches
  nobody until they bump.
- Breaking change → major version, and say what a consumer must edit in the `note:`.
