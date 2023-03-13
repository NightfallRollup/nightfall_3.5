/**
 Route for remote mutex
 */

import express from 'express';
import {
  lockUsableCommitments,
  releaseUsableCommitments,
} from '../services/commitment-storage.mjs';

const router = express.Router();

/**
 * @description Lock usable commitments
 */
router.post('/lock-commitments', async (req, res, next) => {
  const { compressedZkpPublicKey } = req.body;
  try {
    const lockReceipt = await lockUsableCommitments(compressedZkpPublicKey);
    res.json({ lockReceipt });
  } catch (err) {
    next(err);
  }
});

/**
 * @description Unlock usable commitments
 */
router.post('/release-commitments', async (req, res, next) => {
  const { compressedZkpPublicKey, lockReceipt } = req.body;
  try {
    const release = releaseUsableCommitments(compressedZkpPublicKey, lockReceipt);
    res.json({ release });
  } catch (err) {
    next(err);
  }
});

export default router;
