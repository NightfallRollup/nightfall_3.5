import express from 'express';
import { workerEnableSet } from '../event-handlers/transaction-submitted.mjs';

const router = express.Router();

/**
 * Enable/Disable transaction workers
 */
router.post('/transaction-worker-enable', async (req, res) => {
  const { enable } = req.body;
  workerEnableSet(enable);
  res.sendStatus(200);
});
export default router;
