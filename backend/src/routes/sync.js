const express = require('express');
const { runArtifySync } = require('../services/artifySync');
const { runTeamsSync } = require('../services/teamsSync');

const router = express.Router();

// Manual trigger for testing the ARTIFY sync outside of its daily schedule.
router.post('/artify-pull', async (req, res) => {
  const result = await runArtifySync();

  if (result.success) {
    res.json(result);
  } else {
    res.status(502).json(result);
  }
});

// Manual trigger for testing the Teams task-intake sync outside its 5-minute schedule.
router.post('/teams-pull', async (req, res) => {
  const result = await runTeamsSync();

  if (result.success) {
    res.json(result);
  } else {
    res.status(502).json(result);
  }
});

module.exports = router;
