// ignore unused exports default

// Process that handler block proposefd events

import express from 'express';
import { blockProposed } from '../event-handlers/block-proposed.mjs';

async function initWorkers() {
  const app = express();

  app.get('/healthcheck', async (req, res) => {
    res.sendStatus(200);
  });

  // End point to submit block to block proposed worker
  app.get('/block-proposed', async (req, res) => {
    const { blockNumberL2 } = req.query;

    try {
      await blockProposed(Number(blockNumberL2));
      res.sendStatus(200);
    } catch (err) {
      res.sendStatus(500);
    }
  });
  app.listen(4000);
}

initWorkers();

export default initWorkers;
