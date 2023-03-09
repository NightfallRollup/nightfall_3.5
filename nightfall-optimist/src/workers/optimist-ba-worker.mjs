// ignore unused exports default

/*
  Implementation of a worker that handles block assembly

  This cluster of workers is provided as a complementary service to optimist to process
  transactions received in order to boost performance, so that optimist can focus on other activities.
  Optimist doesn't need to use this cluster of workers and can keep processing transactions
  received. To configure Optimist in legacy mode, just provide and invalid value to TX_WORKER_URL.

  Else, the cluster of workers will provide three services to optimist:
  - app.post('/transaction-submitted') : Takes an incomming transaction received by transactionSubmittedEventHandler and
  dispatch it to an available worker
  - app.post('/proposer/offchain-transaction') : Processes offchain transaction. This is the endpoint that optimist
  can advertise when registering as a proposer so that clients send transactions here.
  - app.post('/workers/check-transaction') : Performs several checks on transactions (check duplicate commitment and nullifier, checks
     historic root block number and verifies transaction proof). It is thought mainly to offload optimist from
     processing transactions during block proposed events.
*/

import express from 'express';
import config from 'config';
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import constants from '@polygon-nightfall/common-files/constants/index.mjs';

import {
  conditionalMakeBlock,
  setBlockAssembledWebSocketConnection,
} from '../services/block-assembler.mjs';
import { subscribeToBlockAssembledWebSocketConnection } from '../event-handlers/subscribe.mjs';

await subscribeToBlockAssembledWebSocketConnection(setBlockAssembledWebSocketConnection);

async function initWorkers() {
  const app = express();
  app.use(express.json());

  // Standard healthhcheck
  app.get('/healthcheck', async (req, res) => {
    res.sendStatus(200);
  });

  // End point to submit transactions to tx worker. It is called
  // by Optimist when receiving onchain transactions
  app.post('/block-assembly', async (req, res) => {
    const { proposer } = req.body;
    try {
      const response = conditionalMakeBlock(proposer);
      res.json(response);
    } catch (err) {
      res.sendStatus(500);
    }
  });

  app.listen(80);
}

initWorkers();

export default initWorkers;
