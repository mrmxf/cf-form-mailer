//  Copyright ©2017-2026  Mr MXF   info@mrmxf.com
//  BSD-3-Clause License           https://opensource.org/license/bsd-3-clause/
/**
 * cf-form-mailer — the public entry point.
 *
 * A Worker needs `createHandler` and nothing else:
 *
 *   import { createHandler } from "@mrmxf/cf-form-mailer";
 *
 * The rest is exported for tests and for anything that renders a page itself.
 */
export { createHandler } from "./src/handler.js";
export { validate } from "./src/validate.js";
export { renderForm, renderSuccess, TOKENS } from "./src/render.js";
export { sendFormEmail, headerSafe, isConfigured } from "./src/email.js";
export { trippedHoneypot, verifyTurnstile, HONEYPOT_FIELD } from "./src/turnstile.js";
