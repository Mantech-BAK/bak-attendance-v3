const express = require('express');
const pool = require('../db');
const { getSetting, getRamzanPeriods, setSetting } = require('../services/settings');

const router = express.Router();

const MIN_HOURS = 0.5;
const MAX_HOURS = 24;
const MIN_RAMZAN_HOURS = 1;
const MAX_RAMZAN_HOURS = 8;
const MAX_RAMZAN_SPAN_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

async function getServerToday() {
  const { rows } = await pool.query("SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today");
  return rows[0].today;
}

router.get('/daily-working-hours', async (req, res, next) => {
  try {
    const today = await getServerToday();
    const value = await getSetting(`daily_working_hours:${today}`);
    res.json({ date: today, hours: value === null ? null : Number(value) });
  } catch (err) {
    next(err);
  }
});

// The date is never accepted from the client — it's always the server's own
// clock, the same principle already used for punch_time. This is what
// actually enforces "cannot be backdated," not anything in the UI.
router.post('/daily-working-hours', async (req, res, next) => {
  try {
    const { hours } = req.body;

    if (typeof hours !== 'number' || Number.isNaN(hours)) {
      return res.status(400).json({ error: 'hours is required and must be a number' });
    }
    if (hours < MIN_HOURS || hours > MAX_HOURS) {
      return res.status(400).json({ error: `hours must be between ${MIN_HOURS} and ${MAX_HOURS}` });
    }

    const today = await getServerToday();
    await setSetting(`daily_working_hours:${today}`, String(hours));

    res.json({ date: today, hours });
  } catch (err) {
    next(err);
  }
});

// Replaces the previously-hardcoded 360-minute (6h) constant in
// getEffectiveThreshold. Returns null (not a defaulted 6) when unset, so the
// backoffice can show "not customized" — the calculation engine applies its
// own built-in 360-minute fallback separately when this key is absent.
router.get('/ramzan-working-hours', async (req, res, next) => {
  try {
    const value = await getSetting('ramzan_working_hours_minutes');
    res.json({ minutes: value === null ? null : Number(value), hours: value === null ? null : Number(value) / 60 });
  } catch (err) {
    next(err);
  }
});

router.post('/ramzan-working-hours', async (req, res, next) => {
  try {
    const { hours } = req.body;

    if (typeof hours !== 'number' || Number.isNaN(hours)) {
      return res.status(400).json({ error: 'hours is required and must be a number' });
    }
    if (hours < MIN_RAMZAN_HOURS || hours > MAX_RAMZAN_HOURS) {
      return res.status(400).json({ error: `hours must be between ${MIN_RAMZAN_HOURS} and ${MAX_RAMZAN_HOURS}` });
    }

    const minutes = Math.round(hours * 60);
    await setSetting('ramzan_working_hours_minutes', String(minutes));

    res.json({ minutes, hours });
  } catch (err) {
    next(err);
  }
});

// There is deliberately no PATCH/DELETE for ramzan_periods — declaring a
// period is meant to be a one-way, append-only action from this UI. A
// period declared incorrectly must be corrected directly in the database
// by the dev team, not fixed from the web UI. Do not add an edit/delete
// endpoint here without an explicit product decision to allow it — this
// is intentional, not a missing feature.
router.get('/ramzan-periods', async (req, res, next) => {
  try {
    const periods = await getRamzanPeriods();
    const sorted = [...periods].sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0));
    res.json({ periods: sorted });
  } catch (err) {
    next(err);
  }
});

router.post('/ramzan-periods', async (req, res, next) => {
  try {
    const { start_date, end_date, declared_by } = req.body;

    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date and end_date are required' });
    }
    if (!declared_by) {
      return res.status(400).json({ error: 'declared_by is required' });
    }

    const today = await getServerToday();
    if (start_date < today) {
      return res.status(400).json({ error: `start_date cannot be earlier than today (${today})` });
    }
    if (end_date < start_date) {
      return res.status(400).json({ error: 'end_date cannot be earlier than start_date' });
    }

    const spanDays = (new Date(`${end_date}T00:00:00Z`) - new Date(`${start_date}T00:00:00Z`)) / MS_PER_DAY;
    if (spanDays > MAX_RAMZAN_SPAN_DAYS) {
      return res.status(400).json({ error: `a Ramzan period cannot span more than ${MAX_RAMZAN_SPAN_DAYS} days` });
    }

    const declarerResult = await pool.query('SELECT "EmpId" AS emp_id FROM employees WHERE "EmpId" = $1', [declared_by]);
    if (declarerResult.rows.length === 0) {
      return res.status(400).json({ error: `declared_by ${declared_by} not found` });
    }

    const periods = await getRamzanPeriods();
    const newYear = start_date.slice(0, 4);
    const collidesWithYear = periods.some((period) => period.start_date.slice(0, 4) === newYear);
    if (collidesWithYear) {
      return res.status(400).json({ error: `a Ramzan period has already been declared for ${newYear}` });
    }

    const newPeriod = { start_date, end_date, declared_by, declared_at: new Date().toISOString() };
    periods.push(newPeriod);
    await setSetting('ramzan_periods', JSON.stringify(periods));

    res.status(201).json({ periods });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
