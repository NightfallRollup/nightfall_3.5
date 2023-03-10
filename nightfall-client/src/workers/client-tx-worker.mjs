/* eslint no-shadow: "off" */
import express from 'express';
import cluster from 'cluster';
import config from 'config';
import os from 'os';
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import { setupHttpDefaults } from '@polygon-nightfall/common-files/utils/httputils.mjs';
import {
  withdraw,
  commitment,
  tokenise,
  burn,
  transform,
  transaction,
  transfer,
  deposit,
  debug,
} from '../routes/index.mjs';

const { clientTxWorkerCount } = config.CLIENT_TX_WORKER_PARAMS;

async function initWorkers() {
  if (cluster.isPrimary) {
    const totalCPUs = Math.min(os.cpus().length - 1, Number(clientTxWorkerCount));

    logger.info(`Number of CPUs is ${totalCPUs}`);

    // Fork workers.
    for (let i = 0; i < totalCPUs; i++) {
      cluster.fork();
    }

    cluster.on('exit', worker => {
      logger.error(`worker ${worker.process.pid} died. Forking another one!`);
      cluster.fork();
    });
  } else {
    const app = express();
    app.use(express.json());

    logger.info(`Worker ${process.pid} started`);

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
        app.use('/withdraw', withdraw);
        app.use('/tokenise', tokenise);
        app.use('/burn', burn);
        app.use('/transform', transform);
        app.use('/commitment', commitment);
        app.use('/transaction', transaction);
        app.use('/deposit', deposit);
        app.use('/transfer', transfer);
        app.use('/debug', debug);
      },
      true,
      false,
    );

    app.listen(80);
  }
}

initWorkers();

export default initWorkers;
