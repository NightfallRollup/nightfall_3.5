/* eslint-disable no-shadow */
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import { queueManager, unpauseQueue } from '@polygon-nightfall/common-files/utils/event-queue.mjs';
import express from 'express';
import { setupHttpDefaults } from '@polygon-nightfall/common-files/utils/httputils.mjs';
import { startEventQueue } from '../event-handlers/index.mjs';
import { blockProposedEventHandler } from '../event-handlers/block-proposed.mjs';
import removeBlockProposedEventHandler from '../event-handlers/chain-reorg.mjs';
import { incomingViewingKey } from '../routes/index.mjs';

const eventHandlers = {
  BlockProposed: blockProposedEventHandler,
  removers: {
    BlockProposed: removeBlockProposedEventHandler,
  },
  priority: {
    BlockProposed: 0,
  },
};

const app = express();
setupHttpDefaults(
  app,
  app => {
    app.use('/incoming-viewing-key', incomingViewingKey);
  },
  true,
  false,
);
app.listen(80);

const main = async () => {
  logger.info('Block Proposed Worker initialized...');
  await startEventQueue(queueManager, eventHandlers);
  unpauseQueue(0);
};

main();
