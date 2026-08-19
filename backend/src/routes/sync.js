const express = require('express');
const { runTeamsSync } = require('../services/teamsSync');
const requireBackofficeAuth = require('../middleware/requireBackofficeAuth');

const router = express.Router();

// Manual trigger for testing the Teams task-intake sync outside its 5-minute schedule.
// Backoffice-only.
router.post('/teams-pull', requireBackofficeAuth, async (req, res) => {
  const result = await runTeamsSync();

  if (result.success) {
    res.json(result);
  } else {
    res.status(502).json(result);
  }
});

module.exports = router;
