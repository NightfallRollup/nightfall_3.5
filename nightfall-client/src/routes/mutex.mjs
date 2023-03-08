/**
 Route for remote mutex
 */

import express from 'express';
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import {
  lockUsableCommitments,
  releaseUsableCommitments,
} from '../services/commitment-storage.mjs';

const router = express.Router();

/**
 * @description Lock common resource
 */
router.post('/lock-commitments', async (req, res, next) => {
  const { compressedZkpPublicKey } = req.body;
  logger.info(`RECEIVED LOCK ${compressedZkpPublicKey}`);
  try {
    const lockReceipt = await lockUsableCommitments(compressedZkpPublicKey);
    logger.info(`LOCK RECEIPT ${lockReceipt}`);
    res.json({ lockReceipt });
  } catch (err) {
    next(err);
  }
});

/**
 * @description Unlock common resource
 */
router.post('/release-commitments', async (req, res, next) => {
  const { compressedZkpPublicKey, lockReceipt } = req.body;
  try {
    logger.info(`RECEIVED RELEASE ${compressedZkpPublicKey}, ${lockReceipt}`);
    const release = releaseUsableCommitments(compressedZkpPublicKey, lockReceipt);
    res.json({ release });
    logger.info(`RELEASE RECEIPT ${release}`);
  } catch (err) {
    next(err);
  }
});

export default router;
