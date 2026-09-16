-- Mandatory in/out photo per task punch. photo_path is the object path
-- inside the "punch-photos" Supabase Storage bucket (private bucket —
-- viewed via short-lived signed URLs generated on read, never a public
-- URL stored here). One photo per punch row — the in-punch's own photo,
-- the out-punch's own photo — never shared between the two.
--
-- Run once per environment. Safely re-runnable (ADD COLUMN IF NOT EXISTS).

ALTER TABLE punches ADD COLUMN IF NOT EXISTS photo_path TEXT;
ALTER TABLE punches ADD COLUMN IF NOT EXISTS photo_uploaded_at TIMESTAMP;
