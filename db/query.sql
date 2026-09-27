--  Copyright (c)2017-2026  Mr MXF   info@mrmxf.com
--  BSD-3-Clause License           https://opensource.org/license/bsd-3-clause/
--
-- Every query the engine runs. `clog sqlc` regenerates db/gen/ from this file
-- and db/migrations - never hand-edit db/gen/.
--
-- THIS FILE MUST STAY PURE ASCII. sqlc-gen-ts-d1 slices query text by byte
-- offset: one multi-byte character clips the end off every later query.
--
-- outcome is matched with LIKE so that '%' means "any outcome" - no optional
-- parameters for the sqlite parser to trip on. Paging is keyset on id; the
-- timestamp is only where a listing starts.

-- name: InsertSubmission :exec
INSERT INTO submissions (uid, form, url, timestamp, schema_version, outcome,
                         form_meta, answers, session, workflow)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

-- name: PruneSubmissions :exec
DELETE FROM submissions WHERE form = ? AND timestamp < ?;

-- name: ListNewest :many
SELECT id, uid, form, url, timestamp, schema_version, outcome,
       form_meta, answers, session, workflow
FROM submissions
WHERE form = ? AND outcome LIKE ? AND timestamp <= ? AND id < ?
ORDER BY id DESC
LIMIT ?;

-- name: ListOldest :many
SELECT id, uid, form, url, timestamp, schema_version, outcome,
       form_meta, answers, session, workflow
FROM submissions
WHERE form = ? AND outcome LIKE ? AND timestamp >= ? AND id > ?
ORDER BY id ASC
LIMIT ?;

-- name: GetSubmission :one
SELECT id, uid, form, url, timestamp, schema_version, outcome,
       form_meta, answers, session, workflow
FROM submissions
WHERE form = ? AND uid = ?;

-- name: SummaryByOutcome :many
SELECT outcome, COUNT(*) AS total, MIN(timestamp) AS first_at, MAX(timestamp) AS latest_at
FROM submissions
WHERE form = ?
GROUP BY outcome
ORDER BY outcome;
