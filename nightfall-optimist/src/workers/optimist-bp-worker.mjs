/* eslint-disable no-shadow */
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import { queueManager, unpauseQueue } from '@polygon-nightfall/common-files/utils/event-queue.mjs';
import express from 'express';
import { setupHttpDefaults } from '@polygon-nightfall/common-files/utils/httputils.mjs';
import {
  startEventQueue,
  subscribeToProposedBlockWebSocketConnection,
} from '../event-handlers/index.mjs';
import blockProposedEventHandler, {
  setBlockProposedWebSocketConnection,
} from '../event-handlers/block-proposed.mjs';
import { removeBlockProposedEventHandler } from '../event-handlers/chain-reorg.mjs';
import { debug } from '../routes/index.mjs';

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
    app.use('/debug', debug);
  },
  true,
  false,
);
app.listen(80);

const main = async () => {
  await subscribeToProposedBlockWebSocketConnection(setBlockProposedWebSocketConnection);
  logger.info('Block Proposer Worker initialized...');
  await startEventQueue(queueManager, eventHandlers);
  unpauseQueue(0);
};

main();
