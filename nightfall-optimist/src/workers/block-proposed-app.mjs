/* eslint-disable no-await-in-loop */
// ignore unused exports default

import express from 'express';
import { blockProposed } from '../event-handlers/block-proposed.mjs';
import { getRxBlock, deleteRxBlock } from '../services/database.mjs';

//  ip addr show docker0
async function initWorkers() {
  const app = express();

  app.get('/healthcheck', async (req, res) => {
    res.sendStatus(200);
  });

  // End point to submit block to block proposed worker
  app.get('/block-proposed', async (req, res) => {
    console.log('RECEIVED API CALL BLOCK PROPOSED');
    // const { transactionHashL1, currentBlockCount, block, transactions } = req.query;
    const { blockNumberL2 } = req.query;
    console.log('BLOCK PROPOSED BODY', req.query);
    const { _id, transactionHashL1, currentBlockCount, transactions, ...block } = await getRxBlock(
      Number(req.query.blockNumberL2),
    );
    console.log('Block XXXXX ', block.blockNumberL2);
    deleteRxBlock(Number(blockNumberL2));

    try {
      const response = blockProposed({
        transactionHashL1,
        currentBlockCount,
        block,
        transactions,
      });
      res.json(response);
    } catch (err) {
      res.sendStatus(500);
    }
  });
  app.listen(4000);
}

initWorkers();

export default initWorkers;
