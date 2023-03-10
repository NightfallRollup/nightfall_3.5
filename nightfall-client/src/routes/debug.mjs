import express from 'express';

import * as pm from '@polygon-nightfall/common-files/utils/stats.mjs';

const router = express.Router();

router.get('/pm-stats', (req, res, next) => {
  try {
    const stats = pm.stats();
    res.json({ stats });
  } catch (err) {
    res.sendStatus(500);
    next(err);
  }
});

router.post('/pm-reset', (req, res, next) => {
  try {
    pm.reset();
    res.sendStatus(200);
  } catch (err) {
    res.sendStatus(500);
    next(err);
  }
});

export default router;
