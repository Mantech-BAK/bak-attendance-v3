const express = require('express');
const { runArtifySync } = require('../services/artifySync');

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

module.exports = router;
