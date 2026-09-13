-- Real-data migration prep: one real project's company legal name is 126
-- characters ("MOHAMMED ABDULMOHSIN AL KHARAFI & SONS FOR GENERAL TRADING
-- GENERAL CONTRACTING AND INDUSTRIAL STRUCTURES W.L.L - BAHRAIN BRANC"),
-- overflowing the old varchar(100). Widened to varchar(255), matching
-- EmpName's existing precedent, rather than truncating a real legal name.
--
-- Run once per environment. Safely re-runnable (widening only).

ALTER TABLE projects ALTER COLUMN company TYPE VARCHAR(255);
