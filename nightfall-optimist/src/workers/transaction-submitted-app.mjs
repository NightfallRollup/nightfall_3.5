// ignore unused exports default

/*
  Implementation of a cluster of workers that handle transaction submitted events.
*/

import express from 'express';
import cluster from 'cluster';
import config from 'config';
import os from 'os';
import constants from '@polygon-nightfall/common-files/constants/index.mjs';
import { waitForContract } from '@polygon-nightfall/common-files/utils/contract.mjs';

import {
  submitTransaction,
  transactionSubmittedEventHandler,
} from '../event-handlers/transaction-submitted.mjs';

const { txWorkerCount } = config.TX_WORKER_PARAMS;
const { STATE_CONTRACT_NAME } = constants;

async function initWorkers() {
  if (cluster.isPrimary) {
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

    // Standard healthhcheck
    app.get('/healthcheck', async (req, res) => {
      res.sendStatus(200);
    });

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

    // TODO - pending to integrate
    app.post('/offchain-transaction', async (req, res) => {
      const { transaction } = req.body;
      /*
        When a transaction is built by client, they are generalised into hex(32) interfacing with web3
        The response from on-chain events converts them to saner string values (e.g. uint64 etc).
        Since we do the transfer off-chain, we do the conversation manually here.
       */
      const { circuitHash, fee } = transaction;

      try {
        const stateInstance = await waitForContract(STATE_CONTRACT_NAME);
        const circuitInfo = await stateInstance.methods.getCircuitInfo(circuitHash).call();
        if (circuitInfo.isEscrowRequired) {
          res.sendStatus(400);
        } else {
          /*
              When comparing this with getTransactionSubmittedCalldata,
              note we dont need to decompressProof as proofs are only compressed if they go on-chain.
              let's not directly call transactionSubmittedEventHandler, instead, we'll queue it
             */
          transactionSubmittedEventHandler({
            offchain: true,
            ...transaction,
            fee: Number(fee),
          });

          res.sendStatus(200);
        }
      } catch (err) {
        res.sendStatus(400);
      }
    });

    app.listen(3000);
  }
}

initWorkers();

export default initWorkers;
