/* eslint-disable no-await-in-loop */
// ignore unused exports default

import express from 'express';
import {
  conditionalMakeBlock,
  requestSignalRollbackCompleted,
  setBlockAssembledWebSocketConnection,
} from '../services/block-assembler.mjs';

import { subscribeToBlockAssembledWebSocketConnection } from '../event-handlers/subscribe.mjs';

//  ip addr show docker0
async function initWorkers() {
  await subscribeToBlockAssembledWebSocketConnection(setBlockAssembledWebSocketConnection);
  const app = express();

  app.get('/healthcheck', async (req, res) => {
    res.sendStatus(200);
  });

  // End point to submit block to block proposed worker
  app.get('/block-assembly', async (req, res) => {
    console.log('RECEIVED API CALL BLOCK ASSEMBLY');
    // const { transactionHashL1, currentBlockCount, block, transactions } = req.query;
    const { proposer } = req.query;
    console.log('BLOCK ASSEMBLY BODY', req.query);

    try {
      await conditionalMakeBlock(proposer);
      res.sendStatus(200);
    } catch (err) {
      res.sendStatus(500);
    }
  });

  // End point to submit block to block proposed worker
  app.get('/rollback-completed', async (req, res) => {
    console.log('RECEIVED API ROLLBACK COMPLETED');

    try {
      await requestSignalRollbackCompleted();
      res.sendStatus(200);
    } catch (err) {
      res.sendStatus(500);
    }
  });

  app.listen(5000);
}

initWorkers();

export default initWorkers;
