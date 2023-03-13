/* eslint no-shadow: "off" */

import express from 'express';
import { setupHttpDefaults } from '@polygon-nightfall/common-files/utils/httputils.mjs';
import {
  getContractAddress,
  getContractAbi,
  finaliseWithdrawal,
  isValidWithdrawal,
  setInstantWithdrawl,
  generateZkpKeys,
  x509,
  mutex,
  debug,
} from './routes/index.mjs';

const app = express();

// Add check for syncing state. If it is in syncing state, just respond 400
app.use((req, res, next) => {
  if (req.app.get('isSyncing')) {
    res.sendStatus(400);
    return res.status;
  }
  return next();
});
setupHttpDefaults(
  app,
  app => {
    app.use('/contract-address', getContractAddress);
    app.use('/contract-abi', getContractAbi);
    app.use('/finalise-withdrawal', finaliseWithdrawal);
    app.use('/valid-withdrawal', isValidWithdrawal);
    app.use('/set-instant-withdrawal', setInstantWithdrawl);
    app.use('/generate-zkp-keys', generateZkpKeys);
    app.use('/x509', x509);
    app.use('/mutex', mutex);
    app.use('/debug', debug);
  },
  true,
  false,
);

export default app;
