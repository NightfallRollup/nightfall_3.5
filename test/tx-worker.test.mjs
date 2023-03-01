/* eslint-disable no-await-in-loop */
import chai from 'chai';
import chaiHttp from 'chai-http';
import config from 'config';
import chaiAsPromised from 'chai-as-promised';
import axios from 'axios';
import os from 'os';
import Nf3 from '../cli/lib/nf3.mjs';
import { depositNTransactions, Web3Client, waitForTimeout } from './utils.mjs';
import {
  numberOfUnprocessedTransactions,
  numberOfBufferedTransactions,
} from '../nightfall-optimist/src/services/database.mjs';

// so we can use require with mjs file
chai.use(chaiHttp);
chai.use(chaiAsPromised);

const { txWorkerCount } = config.TX_WORKER_PARAMS;
// we need require here to import jsons
const environment = config.ENVIRONMENTS[process.env.ENVIRONMENT] || config.ENVIRONMENTS.localhost;

const {
  transferValue,
  tokenConfigs: { tokenType, tokenId },
  mnemonics,
  signingKeys,
} = config.TEST_OPTIONS;

const txPerBlock = process.env.TRANSACTIONS_PER_BLOCK || 32;
const nf3Users = [new Nf3(signingKeys.user1, environment), new Nf3(signingKeys.user2, environment)];
const nf3Proposer1 = new Nf3(signingKeys.proposer1, environment);

const web3Client = new Web3Client();

let erc20Address;
let stateAddress;
const eventLogs = [];
let txPerSecondWorkersOn;

const generateNTransactions = async () => {
  const initTx = txPerBlock * 4;
  // disable worker processing and store transactions in tmp collection
  await axios.post(`${environment.optimistApiUrl}/debug/tx-submitted-enable`, {
    enable: false,
  });
  // We create enough transactions to fill blocks full of deposits.
  await depositNTransactions(
    nf3Users[0],
    initTx,
    erc20Address,
    tokenType,
    transferValue,
    tokenId,
    0,
  );

  let nTx = 0;
  let nTx1 = 0;
  // Wait until all transactions are generated
  while (nTx < initTx) {
    nTx = await numberOfBufferedTransactions();
    console.log('N buffered transactions', nTx);
    await waitForTimeout(1000);
  }
  nTx = await numberOfUnprocessedTransactions();
  console.log('Start transaction processing...');
  // enable worker processing and process transactions in tmp
  axios.post(`${environment.optimistApiUrl}/debug/tx-submitted-enable`, { enable: true });
  const startTimeTx = new Date().getTime();
  // while unprocessed transactions (nTx) is less than number of transactions generated (initTx),
  // and number of transactions increases (first block is generated)
  while (nTx >= nTx1 && nTx < initTx) {
    nTx1 = nTx;
    nTx = await numberOfUnprocessedTransactions();
    console.log('N Unprocessed transactions', nTx);
    await waitForTimeout(100);
  }
  const endTimeTx = new Date().getTime();
  return (nTx * 1000) / (endTimeTx - startTimeTx);
};

async function makeBlock() {
  console.log(`Make block...`);
  await nf3Proposer1.makeBlockNow();
  await web3Client.waitForEvent(eventLogs, ['blockProposed']);
}

describe('Tx worker test', () => {
  before(async () => {
    await nf3Proposer1.init(mnemonics.proposer);
    try {
      erc20Address = await nf3Proposer1.getContractAddress('ERC20Mock');
    } catch {
      erc20Address = '0x4315287906f3FCF2345Ad1bfE0f682457b041Fa7';
    }
    const propoposerL1Balance = await nf3Proposer1.getL1Balance(nf3Proposer1.ethereumAddress);
    const minStake = await nf3Proposer1.getMinimumStake();
    console.log(
      `Proposer info - L1 Balance: ${propoposerL1Balance}, Minimum Stake: ${minStake}, Address: ${nf3Proposer1.ethereumAddress}`,
    );
    if (propoposerL1Balance === '0') {
      console.log('Not enough balance in proposer');
      process.exit();
    }

    await nf3Proposer1.registerProposer('http://optimist', minStake);
    await nf3Proposer1.startProposer();

    // Proposer listening for incoming events
    await nf3Users[0].init(mnemonics.user1);
    const userL1Balance = await nf3Users[0].getL1Balance(nf3Users[0].ethereumAddress);
    console.log(
      `User info - L1 Balance: ${userL1Balance}, Address: ${nf3Users[0].ethereumAddress}`,
    );

    stateAddress = await nf3Users[0].stateContractAddress;
    web3Client.subscribeTo('logs', eventLogs, { address: stateAddress });
  });

  describe('Process Transactions', () => {
    /**
     * In this first phase, we want to generate as many transactions as workers to
     * ensure that these workers have enough time to cache intermediate data to
     * speed up the process
     */
    it('Initialize tx worker', async function () {
      const totalCPUs = Math.min(os.cpus().length, Number(txWorkerCount));
      const initTx = totalCPUs * 2;
      // enable workers
      await axios.post(`${environment.optimistApiUrl}/debug/tx-worker-enable`, {
        enable: true,
      });
      // disable worker processing and store transactions in tmp collection
      await axios.post(`${environment.optimistApiUrl}/debug/tx-submitted-enable`, {
        enable: false,
      });
      // We create enough transactions to initialize tx workers
      await depositNTransactions(
        nf3Users[0],
        initTx,
        erc20Address,
        tokenType,
        transferValue,
        tokenId,
        0,
      );

      let nTx = 0;
      // Wait until all transactions are generated
      while (nTx < initTx) {
        nTx = await numberOfBufferedTransactions();
        console.log('N buffered transactions', nTx);
        await waitForTimeout(1000);
      }
      console.log('Start transaction processing...');
      // enable worker processing and process transactions in tmp
      axios.post(`${environment.optimistApiUrl}/debug/tx-submitted-enable`, { enable: true });
      // leave some time for transaction processing
      await waitForTimeout(10000);
      await makeBlock();
    });

    /**
     * In this test, we generate and buffer transactions, and measure how long it takes to
     * process them all at once with workers.
     */

    it('Generate transactions and measure transaction processing and block assembly time with workers on', async function () {
      let pendingBlocks = 1;
      const blockTimestamp = [];
      let startTime;
      // enable workers
      await axios.post(`${environment.optimistApiUrl}/debug/tx-worker-enable`, {
        enable: true,
      });
      txPerSecondWorkersOn = await generateNTransactions();
      console.log('Transactions per second', txPerSecondWorkersOn);
      makeBlock();
      // In this second part, measure time it takes to generate blocks
      while (pendingBlocks) {
        console.log('Pending L2 blocks', pendingBlocks);
        startTime = new Date().getTime();
        await web3Client.waitForEvent(eventLogs, ['blockProposed']);
        blockTimestamp.push(new Date().getTime() - startTime);
        pendingBlocks -= 1;
      }
      console.log('Block times', blockTimestamp);
    });

    /**
     * In this test, we generate and buffer transactions, and measure how long it takes to
     * process them all at once without workers.
     */
    it('Generate transactions and measure transaction processing and block assembly time with workers off', async function () {
      let pendingBlocks = 1;
      const blockTimestamp = [];
      let startTime;
      // disable workers
      await axios.post(`${environment.optimistApiUrl}/debug/tx-worker-enable`, {
        enable: false,
      });
      const txPerSecond = await generateNTransactions();
      console.log('Transactions per second', txPerSecond);
      // check that we can process more than 50 transactions per second. In reality, it should be more.
      expect(txPerSecondWorkersOn).to.be.greaterThan(txPerSecond);
      makeBlock();

      // In this second part, measure time it takes to generate blocks
      while (pendingBlocks) {
        console.log('Pending L2 blocks', pendingBlocks);
        startTime = new Date().getTime();
        await web3Client.waitForEvent(eventLogs, ['blockProposed']);
        blockTimestamp.push(new Date().getTime() - startTime);
        pendingBlocks -= 1;
      }
      console.log('Block times', blockTimestamp);
    });
  });

  after(async () => {
    await nf3Proposer1.deregisterProposer();
    await nf3Proposer1.close();
    await nf3Users[0].close();
    await web3Client.closeWeb3();
  });
});
