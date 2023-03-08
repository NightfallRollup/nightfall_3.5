import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import { checkCircuits } from '@polygon-nightfall/common-files/utils/sync-files.mjs';
import cluster from 'cluster';
import config from 'config';
import os from 'os';
import app from './app.mjs';
import rabbitmq from './utils/rabbitmq.mjs';
import queues from './queues/index.mjs';

const { circomWorkerCount } = config.CIRCOM_WORKER_PARAMS;

const main = async () => {
  if (cluster.isPrimary) {
    const totalCPUs = Math.min(os.cpus().length, circomWorkerCount);

    // Fork workers.
    for (let i = 0; i < totalCPUs; i++) {
      cluster.fork();
    }

    cluster.on('exit', worker => {
      logger.error(`worker ${worker.process.pid} died. Forking another one!`);
      cluster.fork();
    });
  } else {
    try {
      logger.info(`Worker ${process.pid} started`);
      await checkCircuits();

      // 1 means enable it
      // 0 mean keep it disabled
      if (Number(process.env.ENABLE_QUEUE)) {
        await rabbitmq.connect();
        queues();
      }

      app.listen(80);
    } catch (err) {
      logger.error(err);
      process.exit(1);
    }
  }
};

main();
