--  Copyright (c)2017-2026  Mr MXF   info@mrmxf.com
--  BSD-3-Clause License           https://opensource.org/license/bsd-3-clause/
--
-- The submission log. This directory is BOTH the D1 migrations directory
-- (wrangler d1 migrations apply, via migrations_dir in the consumer's
-- wrangler.jsonc) AND the sqlc schema. Never edit an applied migration: add a
-- new numbered file, bump ROW_SCHEMA in src/store.js and teach toRecord() the
-- new layout.
--
-- One row per POST, whatever happened to it. One database per SITE: every form
-- on the site shares it, keyed on `form`, and each form's Worker reads only
-- its own rows.
--
-- Never an IP address, in any column. See session in src/store.js.

CREATE TABLE submissions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT, -- insertion order; internal, never exposed
  uid            TEXT NOT NULL UNIQUE,              -- crypto.randomUUID(); the public id
  form           TEXT NOT NULL,                     -- form.id, e.g. "parking"
  url            TEXT NOT NULL,                     -- the URL that was POSTed to
  timestamp      TEXT NOT NULL,                     -- Date.toISOString(): UTC, sorts as text
  schema_version INTEGER NOT NULL,                  -- the layout of THIS row
  outcome        TEXT NOT NULL,                     -- sent | send-failed | invalid | turnstile | honeypot
  form_meta      TEXT NOT NULL CHECK (json_valid(form_meta)), -- {id, version, engine, fields}
  answers        TEXT NOT NULL CHECK (json_valid(answers)),   -- field values; {} unless sent/send-failed
  session        TEXT NOT NULL CHECK (json_valid(session)),   -- browser + anti-spam signals
  workflow       TEXT NOT NULL CHECK (json_valid(workflow))   -- {"events":[{event,timestamp,status,statusMessage}]}
);
CREATE INDEX submissions_form_id      ON submissions (form, id);
CREATE INDEX submissions_form_outcome ON submissions (form, outcome, id);
