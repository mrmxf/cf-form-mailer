# AGENTS.md — cf-form-mailer

Instructions for any coding agent working in this repo. `CLAUDE.md` points here; keep
this file the only copy.

A Cloudflare Worker engine: one npm package, consumed by a site's `cf_tools/form-*/`
directory, which supplies only its questions, its wording and its `site.js`.

`npm test` is the only gate. There is no build and no type-check. It must pass before
any commit.
After editing `db/query.sql` or a migration, run `clog sqlc` first (needs `sqlc` on PATH).

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
src/store.js    the submission log: builds the D1 row, toRecord(), the reads
src/access.js   Cloudflare Access JWT verification (WebCrypto, no deps)
src/reader.js   the /api/v1 reader routes
src/version.js  ENGINE_VERSION - must equal package.json (tested)
src/*.test.js   every promise the package makes
test/           fake D1 over node:sqlite + fixtures. Tests only, never shipped
db/migrations/  D1 migrations AND the sqlc schema. Shipped: consumers point migrations_dir here
db/query.sql    every query. PURE ASCII
db/gen/         sqlc output (.ts) + querier.js, the type-stripped copy the engine imports
db/strip-gen.mjs  .ts -> .js, run by `clog sqlc`
sqlc.yaml       sqlc-gen-ts-d1 wasm plugin, pinned by sha256
examples/       copy-in embed wrappers: html/ hugo/ jekyll/ + css/. Not bundled.
releases.yaml   version history, newest first. NOT a golang project: tags have no "v"
```

## Rules

### The package is site-agnostic
- A site name, URL, colour, font or address in `src/` is a bug. It comes from `form.site`
  (the consumer's `site.js`) or from `env`.
- Two sites consume this: `www-mrmxf-com/cf_tools/` and
  `www-chiddingfoldbonfire/cf_tools/`. A change here reaches every form on both.
- No runtime dependencies, ever. `dependencies` stays absent: this runs on the Workers
  runtime, so no Node APIs and no npm packages — `fetch`, `FormData`, `URL`, `Response`,
  `crypto.subtle`. sqlc is a dev-time generator; its committed output is plain JS with
  no imports.
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

### Embed mode — the DEFAULT way to use this package
- Recommend, and assume, the embedded shape for a Hugo or Jekyll site: the Worker routed
  at `/forms/<name>*`, and a page of the site's own — with its navigation, header and
  footer — embedding it in an iframe with `?embed=1`. Suggest it whenever someone is
  wiring a form into a static site.
- The standalone shape (the Worker routed on `/contact*`, so it IS that page) is the
  exception. It costs the site's navigation and chrome. If a site chooses it, the reason
  belongs in that site's own docs.
- `?embed=1` drops `<header>`/`<footer>`, uses `copy.embedIntro` when present, and posts
  back to `?embed=1` so errors and the thank-you stay in the frame.
- `<base target="_parent">` needs the form's `target="_self"`. Remove one and a submit
  navigates the whole host page away.
- The frame is sized by script, which needs the Worker to be SAME-ORIGIN with the page —
  its own domain, never `*.workers.dev`. Cross-origin it fails quietly and the CSS
  `min-height` stands. Do not "fix" that with postMessage before asking: the quiet
  fallback is what keeps `hugo server` and `jekyll serve` working.
- `examples/html`, `examples/hugo` and `examples/jekyll` are three wrappers around ONE
  script and must stay behaviourally identical. Change the embed contract — the
  post-back URL, `base`/`target`, the CSP, the class names — and update all three plus
  `examples/css/form-frame.css` in the same commit.
- Routing a staging host and the live host to the SAME Worker is deliberate where a site
  does it: a submission from staging is a live end-to-end test of the real path. Do not
  "fix" it by splitting the Worker unless that site's docs ask for it.

### Submission log (D1)
- Opt-in by the `FORM_DB` binding. Without it the engine must behave exactly as without
  the feature: no writes, no errors.
- Every POST exit goes through `finish()` in `handler.js`. A new exit that skips it is
  an unlogged outcome.
- The log NEVER changes the response. A D1 failure is `console.error`ed, and the visitor
  still gets the page they would have got: by then the email has gone.
- Never store an IP address, in any column. `CF-Connecting-IP` stays in the email only.
- `answers` is stored ONLY for `sent` and `send-failed`. `buildRow` enforces it whatever
  it is passed.
- `db/query.sql` must stay pure ASCII: sqlc-gen-ts-d1 slices by byte offset, and one
  multi-byte character clips every later query.
- Never hand-edit `db/gen/`. Run `clog sqlc`; the tests fail if `querier.js` drifts from
  `querier.ts`.
- Never edit an applied migration: consumers have already run it. Add `000N_*.sql`, bump
  `ROW_SCHEMA` in `store.js`, and give `toRecord()` a branch for the new layout.
- A new outcome goes in `OUTCOMES` and needs a test that logs it.

### Reader API
- A raw row never leaves the Worker. Everything goes through `toRecord()`; `/v1` is the
  public contract and is versioned separately from `schema_version`.
- Fail closed, in this order: no `FORM_DB` → 503, no Access config → 503, bad JWT → 403.
- `verifyAccess` pins `RS256` and checks signature, `iss`, `aud`, `exp` and `nbf`. Never
  let the token choose its algorithm, and never drop one of those checks.
- The dev bypass needs BOTH `DRY_RUN === "true"` AND a localhost host. Never loosen it
  to either one alone.
- GET only. Each form's Worker reads only its own `form` rows.

### Email
- Mailtrap HTTP API, not SMTP: Workers block port 25.
- Cloudflare `send_email` is not an option — it only delivers to a pre-verified
  Destination Address. Email Routing is the RECEIVE side and is not this package.

### Tests
- `src/mailer.test.js` covers header injection, escaping, failing closed, the honeypot, a
  failed send, theming and the guard. A change to any of those behaviours changes a test —
  if none breaks, the test was too weak.
- No network in tests: stub `globalThis.fetch`. Addresses are `example.test`.
- D1 in tests is `test/fake-d1.js`: real SQLite (`node:sqlite`) running the real
  migrations, so a query D1 would reject fails here too.

### Public repo
- No real addresses, keys, tokens or customer names in code, tests or docs.

### Releases
- A release is a row at the TOP of `releases.yaml` plus a matching git tag, no leading
  `v`. Consumers pin `github:mrmxf/cf-form-mailer#<tag>`, so an unreleased change reaches
  nobody until they bump.
- Breaking change → major version, and say what a consumer must edit in the `note:`.
