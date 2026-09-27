/**
 * The HTML page. One template literal, no build step, no framework.
 *
 * Styling comes from the consumer's site.js (form.site): colour tokens, fonts, the
 * site's name and URL. The page copies the site's tokens rather than fetching
 * its stylesheet, so a Worker stays standalone and cannot be broken by a CSS
 * change. A restyle means editing site.js by hand.
 *
 *   site.theme.light only  -> light page
 *   site.theme.dark only   -> forced dark (a white form flashing up from a dark
 *                             site looks broken)
 *   both                   -> follows prefers-color-scheme
 *
 * EMBED MODE (`?embed=1`, set by lib/handler.js): the page is shown inside an
 * iframe on the site (Hugo `form-frame` shortcode), which already has its own h1,
 * heading and footer. So an embedded page drops <header> and <footer>, uses
 * `copy.embedIntro` in place of `copy.intro` when a form defines one, and loses
 * the body padding. `<base target="_parent">` sends links out to the site page;
 * the <form> carries `target="_self"` to override it, or a submit would post the
 * whole site page away. The form posts back to `?embed=1`, so error and
 * thank-you pages stay embedded.
 */

import { HONEYPOT_FIELD, RENDERED_FIELD } from "./turnstile.js";

/** Escape for use in HTML text and double-quoted attributes. */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The token names every site.js theme block must define. */
export const TOKENS = ["primary", "primary-hover", "on-primary", "error", "error-bg",
  "bg", "surface", "body", "meta", "link", "border"];

function tokenBlock(t) {
  return TOKENS.map((k) => `    --${k}: ${t[k]};`).join("\n");
}

/** :root colour tokens for the site's theme - see the header comment. */
function themeCss(theme) {
  const { light, dark } = theme;
  if (light && dark) {
    return `  :root {\n${tokenBlock(light)}\n  }\n` +
      `  @media (prefers-color-scheme: dark) {\n  :root {\n${tokenBlock(dark)}\n  }\n  }\n`;
  }
  return `  :root {\n${tokenBlock(light || dark)}\n  }\n`;
}

const STYLES = (site) => `
${themeCss(site.theme)}
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0 1rem 4rem;
    background: var(--bg);
    color: var(--body);
    font-family: ${site.fonts.body};
    font-size: 16px;
    line-height: 1.6;
  }
  .wrap { max-width: 40rem; margin: 0 auto; }
  header {
    margin: 0 -1rem 2rem;
    padding: 2.5rem 1rem 2rem;
    background: var(--primary);
    color: var(--on-primary);
    text-align: center;
  }
  h1, h2 {
    font-family: ${site.fonts.heading};
    font-weight: 700;
    margin: 0;
  }
  h1 { font-size: 1.75rem; }
  header p { margin: .5rem 0 0; opacity: .92; }
  .intro { color: var(--meta); }
  .intro a, footer a { color: var(--link); }

  fieldset { border: 0; margin: 0 0 1.5rem; padding: 0; }
  legend { font-weight: 700; padding: 0; }
  .field { margin-bottom: 1.25rem; }
  label { display: block; font-weight: 700; margin-bottom: .25rem; }
  .hint { display: block; font-weight: 400; color: var(--meta); font-size: .875rem; }
  input[type=text], input[type=email], input[type=tel], textarea {
    width: 100%;
    padding: .65rem .75rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    font: inherit;
    color: var(--body);
    background: var(--surface);
  }
  textarea { min-height: 9rem; resize: vertical; line-height: 1.5; }
  input:focus-visible, textarea:focus-visible, button:focus-visible, .radio input:focus-visible {
    outline: 3px solid var(--link);
    outline-offset: 2px;
  }
  .radios { display: flex; gap: 1.5rem; margin-top: .35rem; }
  .radio { display: flex; align-items: center; gap: .4rem; font-weight: 400; margin: 0; }
  .radio input { accent-color: var(--primary); width: 1.1rem; height: 1.1rem; }

  .field.has-error input, .field.has-error textarea { border-color: var(--error); }
  .error { color: var(--error); font-size: .875rem; margin-top: .25rem; }

  /* Honeypot. Hidden from people, left in the DOM for bots to find.
     Not display:none — some bots skip those. */
  .hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }

  /* Pill buttons */
  button {
    font-family: ${site.fonts.body};
    border: none;
    border-radius: 300px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 15px 30px;
    font-size: 1rem;
    color: var(--on-primary);
    background: var(--primary);
    cursor: pointer;
  }
  button:hover:not(:disabled) { background: var(--primary-hover); }
  button:disabled { opacity: .6; cursor: progress; }

  .summary {
    border-left: 4px solid var(--error);
    background: var(--error-bg);
    padding: .75rem 1rem;
    margin-bottom: 1.5rem;
  }
  .summary p { margin: 0; font-weight: 700; color: var(--error); }

  .done {
    border-left: 4px solid var(--primary);
    background: var(--surface);
    padding: 1.25rem 1.5rem;
  }
  .done h2 { color: var(--link); margin-bottom: .5rem; }
  footer { margin-top: 3rem; color: var(--meta); font-size: .875rem; text-align: center; }

  /* Embedded: the site page supplies the margins. The few px left over keep the
     3px + 2px focus outline from being clipped at the iframe edge. */
  body.embed { padding: 6px; }
  body.embed .wrap { max-width: none; }
`;

const HEAD = (site, title, embed = false) => `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${esc(title)}</title>${embed ? `
  <base target="_parent">` : ""}
${site.fonts.href ? `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${esc(site.fonts.href)}" rel="stylesheet">` : ""}
  <style>${STYLES(site)}</style>`;

/** The standalone page's banner and footer. Both are left out in embed mode. */
const pageHeader = (heading, eventName) => `<header>
    <h1>${esc(heading)}</h1>
    <p>${esc(eventName)}</p>
  </header>`;

const pageFooter = (site, eventName) => `<footer>
    <p>${esc(eventName)} &middot; <a href="${esc(site.url)}">${esc(new URL(site.url).host)}</a></p>
  </footer>`;

function renderField(field, values, errors) {
  const err = errors[field.name];
  const value = values[field.name] ?? "";
  const describedBy = [
    field.hint ? `${field.name}-hint` : null,
    err ? `${field.name}-error` : null,
  ].filter(Boolean).join(" ");
  const aria = describedBy ? ` aria-describedby="${describedBy}"` : "";

  const hint = field.hint
    ? `<span class="hint" id="${field.name}-hint">${esc(field.hint)}</span>`
    : "";
  const error = err
    ? `<p class="error" id="${field.name}-error">${esc(err)}</p>`
    : "";
  const req = field.required ? "" : ' <span class="hint" style="display:inline">(optional)</span>';

  if (field.type === "radio") {
    const radios = field.options.map((o) => `
        <label class="radio">
          <input type="radio" name="${field.name}" value="${esc(o.value)}"
                 ${value === o.value ? "checked" : ""}
                 ${field.required ? "required" : ""}${aria}>
          ${esc(o.label)}
        </label>`).join("");
    return `
      <fieldset class="field${err ? " has-error" : ""}">
        <legend>${esc(field.label)}${req}</legend>
        ${hint}
        <div class="radios">${radios}</div>
        ${error}
      </fieldset>`;
  }

  if (field.type === "textarea") {
    return `
      <div class="field${err ? " has-error" : ""}">
        <label for="${field.name}">${esc(field.label)}${req}</label>
        ${hint}
        <textarea id="${field.name}" name="${field.name}"
                  maxlength="${field.maxLength}"
                  ${field.placeholder ? `placeholder="${esc(field.placeholder)}"` : ""}
                  ${field.required ? "required" : ""}${aria}>${esc(value)}</textarea>
        ${error}
      </div>`;
  }

  return `
      <div class="field${err ? " has-error" : ""}">
        <label for="${field.name}">${esc(field.label)}${req}</label>
        ${hint}
        <input type="${field.type}" id="${field.name}" name="${field.name}"
               value="${esc(value)}"
               maxlength="${field.maxLength}"
               ${field.placeholder ? `placeholder="${esc(field.placeholder)}"` : ""}
               ${field.autocomplete ? `autocomplete="${field.autocomplete}"` : ""}
               ${field.required ? "required" : ""}${aria}>
        ${error}
      </div>`;
}

/**
 * @param {object} opts
 * @param {object} opts.form      The form definition (fields, copy).
 * @param {string} opts.siteKey   Turnstile site key (public).
 * @param {string} opts.eventName
 * @param {Record<string,string>} [opts.values]  Sticky values on a failed submit.
 * @param {Record<string,string>} [opts.errors]  Per-field errors.
 * @param {string} [opts.formError]              Whole-form error (e.g. Turnstile).
 * @param {string} [opts.renderedAt]  When the visitor first got the form: a
 *        re-render after an error carries it forward so elapsed time is from the
 *        first view. Visitor-supplied, so only a parseable date is kept.
 * @param {boolean} [opts.embed]                 Render for an iframe — see EMBED MODE above.
 */
export function renderForm({ form, siteKey, eventName, values = {}, errors = {}, formError = "", embed = false, renderedAt = "" }) {
  const shownAt = Number.isNaN(Date.parse(renderedAt)) ? new Date().toISOString() : new Date(Date.parse(renderedAt)).toISOString();
  const errorCount = Object.keys(errors).length;
  const intro = embed && "embedIntro" in form.copy ? form.copy.embedIntro : form.copy.intro;
  const summary = errorCount || formError
    ? `<div class="summary" role="alert" tabindex="-1" id="summary">
         <p>${formError ? esc(formError) : `Please check ${errorCount} ${errorCount === 1 ? "answer" : "answers"} below.`}</p>
       </div>`
    : "";

  return `<!doctype html>
<html lang="${esc(form.site.lang || "en-GB")}">
<head>
  ${HEAD(form.site, `${form.copy.title} | ${eventName}`, embed)}
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</head>
<body${embed ? ' class="embed"' : ""}>
  ${embed ? "" : pageHeader(form.copy.heading, eventName)}
  <div class="wrap">
    ${intro ? `<p class="intro">${intro}</p>` : ""}
    ${summary}
    <form method="post" ${embed ? 'action="?embed=1" target="_self"' : 'action=""'} novalidate>
      ${form.fields.map((f) => renderField(f, values, errors)).join("")}

      <div class="hp" aria-hidden="true">
        <label for="${HONEYPOT_FIELD}">Second address line</label>
        <input type="text" id="${HONEYPOT_FIELD}" name="${HONEYPOT_FIELD}"
               tabindex="-1" autocomplete="off">
      </div>
      <input type="hidden" name="${RENDERED_FIELD}" value="${esc(shownAt)}">

      <div class="cf-turnstile" data-sitekey="${esc(siteKey)}" data-theme="${form.site.theme.light ? "auto" : "dark"}"></div>
      <p class="error" id="turnstile-error" hidden>Please complete the check above.</p>

      <p><button type="submit">${esc(form.copy.submit)}</button></p>
    </form>
  </div>
  ${embed ? "" : pageFooter(form.site, eventName)}
  <script>
  // Vanilla IIFE, matching the house style in the site's cookie banner.
  (function () {
    "use strict";
    var form = document.querySelector("form");
    var button = form.querySelector("button[type=submit]");
    var tsError = document.getElementById("turnstile-error");

    form.addEventListener("submit", function (e) {
      // Turnstile writes its token into a hidden input it injects itself.
      var token = form.querySelector("[name=cf-turnstile-response]");
      if (!token || !token.value) {
        e.preventDefault();
        tsError.hidden = false;
        return;
      }
      // Guard against a double submit producing two emails. Disabling the button
      // before the navigation starts is safe here because the form posts
      // normally — there is no fetch to cancel.
      button.disabled = true;
      button.textContent = "Sending\\u2026";
    });

    var summary = document.getElementById("summary");
    if (summary) summary.focus();
  })();
  </script>
</body>
</html>`;
}

/** The thank-you page. Also what a honeypot-tripping bot is shown. */
export function renderSuccess({ form, eventName, embed = false }) {
  return `<!doctype html>
<html lang="${esc(form.site.lang || "en-GB")}">
<head>
  ${HEAD(form.site, `${form.copy.successTitle} | ${eventName}`, embed)}
</head>
<body${embed ? ' class="embed"' : ""}>
  ${embed ? "" : pageHeader(form.copy.successTitle, eventName)}
  <div class="wrap">
    <div class="done">
      <h2>Thank you</h2>
      ${form.copy.successBody}
    </div>
  </div>
  ${embed ? "" : pageFooter(form.site, eventName)}
</body>
</html>`;
}
