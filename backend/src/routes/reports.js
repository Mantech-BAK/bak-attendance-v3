const express = require('express');
const { generateConfirmationSheetRows } = require('../services/dailyConfirmation');
const { buildConfirmationSheetWorkbook } = require('../services/confirmationSheetExcel');
const requireBackofficeAuth = require('../middleware/requireBackofficeAuth');

const router = express.Router();

// Every route in this file is backoffice-only — mobile never touches reports.
router.use(requireBackofficeAuth);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Generated on-demand only — never automatically pushed anywhere. Detecting
// OT while building the rows also ensures a pending ot_approvals row exists
// (see generateConfirmationSheetRows), so running this report is itself
// enough to surface OT to the reporting manager, without waiting on the
// nightly cron.
router.get('/confirmation-sheet', async (req, res, next) => {
  try {
    const { date } = req.query;
    if (!date || !DATE_PATTERN.test(date)) {
      return res.status(400).json({ error: 'date is required in YYYY-MM-DD format' });
    }

    const rows = await generateConfirmationSheetRows(date);
    const workbook = await buildConfirmationSheetWorkbook(date, rows);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="confirmation-sheet-${date}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
