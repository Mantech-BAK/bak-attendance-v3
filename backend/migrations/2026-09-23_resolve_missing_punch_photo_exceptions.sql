-- A missing/never-added punch photo is confirmed (2026-09-23) to never be
-- an exception at all — photos are fully optional, so "employee just didn't
-- add one" isn't a broken/incomplete state worth flagging. The sweep that
-- raised missing_punch_photo exceptions (services/missingPunchPhotoExceptions.js,
-- jobs/missingPunchPhotoCron.js) has been removed entirely; this closes out
-- whatever it had already raised before that removal, so the Exceptions
-- queue doesn't keep showing now-invalid open items. Purely a status flip —
-- no rows deleted, no other exception type touched.

UPDATE exceptions
SET status = 'resolved'
WHERE type = 'missing_punch_photo' AND status = 'open';
