import express from 'express';

import * as pm from '@polygon-nightfall/common-files/utils/stats.mjs';
import { getDebugCounters } from '../services/debug-counters.mjs';

const router = express.Router();

router.get('/counters', async (req, res, next) => {
  try {
    const counters = getDebugCounters();
    res.json({ counters });
  } catch (err) {
    next(err);
  }
});

router.get('/pm-stats', async (req, res, next) => {
  try {
    const stats = pm.stats();
    res.json({ stats });
  } catch (err) {
    res.sendStatus(500);
    next(err);
  }
});

router.post('/pm-reset', async (req, res, next) => {
  try {
    pm.reset();
    res.sendStatus(200);
  } catch (err) {
    res.sendStatus(500);
    next(err);
  }
});

export default router;
