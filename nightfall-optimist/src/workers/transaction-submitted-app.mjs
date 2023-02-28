/* eslint-disable no-await-in-loop */
// ignore unused exports default

import express from 'express';
import cluster from 'cluster';
import config from 'config';
import os from 'os';
import axios from 'axios';
import fs from 'fs';

import { waitForContract } from '@polygon-nightfall/common-files/utils/contract.mjs';
import constants from '@polygon-nightfall/common-files/constants/index.mjs';
import { submitTransaction } from '../event-handlers/transaction-submitted.mjs';

const { txWorkerCount, txWorkerOptimistApiUrl } = config.TX_WORKER_PARAMS;
const { STATE_CONTRACT_NAME, CHALLENGES_CONTRACT_NAME, SHIELD_CONTRACT_NAME } = constants;

//  ip addr show docker0
async function initWorkers() {
  let shieldInterface;
  let challengesInterface;
  let stateInterface;
  if (cluster.isPrimary) {
    // Contact with optimist and download Shield, State and Challenges jsons.
    if (!process.env.TX_WORKER_DOCKER) {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          shieldInterface = await axios.get(
            `${txWorkerOptimistApiUrl}/contract-abi/interface/Shield`,
            {
              timeout: 10000,
            },
          );
          challengesInterface = await axios.get(
            `${txWorkerOptimistApiUrl}/contract-abi/interface/Challenges`,
            {
              timeout: 10000,
            },
          );
          stateInterface = await axios.get(
            `${txWorkerOptimistApiUrl}/contract-abi/interface/State`,
            {
              timeout: 10000,
            },
          );
          break;
        } catch (err) {
          console.log('Downloading contracts. Retrying...');
          await new Promise(resolve => setTimeout(() => resolve(), 5000)); // eslint-disable-line no-await-in-loop
        }
      }
      if (!fs.existsSync(`${config.CONTRACT_ARTIFACTS}/Shield.json`)) {
        fs.writeFileSync(
          `${config.CONTRACT_ARTIFACTS}/Shield.json`,
          JSON.stringify(shieldInterface.data.interface, null, 2),
          'utf-8',
        );
      }
      if (!fs.existsSync(`${config.CONTRACT_ARTIFACTS}/Challenges.json`)) {
        fs.writeFileSync(
          `${config.CONTRACT_ARTIFACTS}/Challenges.json`,
          JSON.stringify(challengesInterface.data.interface, null, 2),
          'utf-8',
        );
      }
      if (!fs.existsSync(`${config.CONTRACT_ARTIFACTS}/State.json`)) {
        fs.writeFileSync(
          `${config.CONTRACT_ARTIFACTS}/State.json`,
          JSON.stringify(stateInterface.data.interface, null, 2),
          'utf-8',
        );
      }
    }

    const totalCPUs = Math.min(os.cpus().length - 1, Number(txWorkerCount));

    console.log(`Number of CPUs is ${totalCPUs}`);

    // Fork workers.
    for (let i = 0; i < totalCPUs; i++) {
      cluster.fork();
    }

    cluster.on('exit', worker => {
      console.log(`worker ${worker.process.pid} died`);
      console.log("Let's fork another worker!");
      cluster.fork();
    });
  } else {
    const app = express();
    console.log(`Worker ${process.pid} started`);

    app.get('/healthcheck', async (req, res) => {
      res.sendStatus(200);
    });

    await waitForContract(SHIELD_CONTRACT_NAME);
    await waitForContract(STATE_CONTRACT_NAME);
    await waitForContract(CHALLENGES_CONTRACT_NAME);
    console.log(`worker ${process.pid} downloaded contracts`);

    // End point to submit transaction to tx worker
    app.get('/tx-submitted', async (req, res) => {
      const { tx, enable } = req.query;
      try {
        const response = submitTransaction(JSON.parse(tx), enable === 'true');
        res.json(response);
      } catch (err) {
        res.sendStatus(500);
      }
    });
    app.listen(3000);
  }
}

initWorkers();

export default initWorkers;
