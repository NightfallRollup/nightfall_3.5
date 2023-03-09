/* eslint-disable no-await-in-loop */
import chai from 'chai';
import chaiHttp from 'chai-http';
import config from 'config';
import chaiAsPromised from 'chai-as-promised';
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import PerformanceBenchmark from '../common-files/utils/performance-benchmark.mjs';
import Nf3 from '../cli/lib/nf3.mjs';
import {
  depositNTransactionsAsync,
  transferNTransactionsAsync,
  Web3Client,
  waitForTimeout,
} from './utils.mjs';
import { numberOfMempoolTransactions } from '../nightfall-optimist/src/services/database.mjs';

// instantiate new PerformanceBenchmark
const performanceBenchmark = new PerformanceBenchmark();

// so we can use require with mjs file
chai.use(chaiHttp);
chai.use(chaiAsPromised);

// we need require here to import jsons
const environment = config.ENVIRONMENTS[process.env.ENVIRONMENT] || config.ENVIRONMENTS.localhost;
const { optimistTxWorkerApiUrl } = environment;
const { N_TRANSACTIONS = 20 } = process.env;

const {
  tokenConfigs: { tokenType, tokenId },
  mnemonics,
  signingKeys,
} = config.TEST_OPTIONS;

const initTx = N_TRANSACTIONS;
const nf3Users = [new Nf3(signingKeys.user1, environment), new Nf3(signingKeys.user2, environment)];
const nf3Proposer1 = new Nf3(signingKeys.proposer1, environment);
const transferValue = 1;
const depositValue = 200;

const web3Client = new Web3Client();

let erc20Address;
let stateAddress;
const eventLogs = [];

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

    console.log(`Connecting to TX Workers at ${optimistTxWorkerApiUrl}`);
    await nf3Proposer1.registerProposer('http://optimist', minStake);
    await nf3Proposer1.startProposer();
    await waitForTimeout(5000);

    console.log(`Generating ${N_TRANSACTIONS} transactions`);

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
    it('Initial Deposits', async function () {
      logger.info('Start');
      const balance = await nf3Users[0].getLayer2Balances();
      console.log('L2 Balance', balance);
      console.log(`Requesting ${initTx} deposits`);
      // We create enough transactions to initialize tx workers
      performanceBenchmark.start('Deposits');
      await depositNTransactionsAsync(
        nf3Users[0],
        initTx,
        erc20Address,
        tokenType,
        depositValue,
        tokenId,
        0,
      );
      performanceBenchmark.stop('Deposits');
      await waitForTimeout(50000);
      let nTx = await numberOfMempoolTransactions();
      console.log('Pending transactions on mempool', nTx);
      while (nTx) {
        performanceBenchmark.start('Blocks');
        await makeBlock();
        performanceBenchmark.stop('Blocks');
        nTx = await numberOfMempoolTransactions();
        console.log('Pending transactions on mempool', nTx);
      }

      // log stats for id a
      console.log(JSON.stringify(performanceBenchmark.stats('Deposits'), null, 4));
      console.log(JSON.stringify(performanceBenchmark.stats('Blocks'), null, 4));
    });

    it('Deposits/Transfers', async function () {
      logger.info('Start');
      console.log(`Requesting ${initTx} deposits and transfers`);
      // We create enough transactions to initialize tx workers
      performanceBenchmark.start('Deposits');
      await depositNTransactionsAsync(
        nf3Users[0],
        initTx / 2,
        erc20Address,
        tokenType,
        depositValue,
        tokenId,
        0,
      );
      performanceBenchmark.stop('Deposits');
      performanceBenchmark.start('Transfers');
      await transferNTransactionsAsync(
        nf3Users[0],
        initTx / 2,
        erc20Address,
        tokenType,
        transferValue,
        tokenId,
        nf3Users[0].zkpKeys.compressedZkpPublicKey,
        0,
        true,
      );
      performanceBenchmark.stop('Transfers');
      await waitForTimeout(50000);
      let nTx = await numberOfMempoolTransactions();
      console.log('Pending transactions on mempool', nTx);
      while (nTx) {
        performanceBenchmark.start('Blocks');
        await makeBlock();
        performanceBenchmark.stop('Blocks');
        nTx = await numberOfMempoolTransactions();
        console.log('Pending transactions on mempool', nTx);
      }

      // log stats for id a
      console.log(JSON.stringify(performanceBenchmark.stats('Deposits'), null, 4));
      console.log(JSON.stringify(performanceBenchmark.stats('Transfers'), null, 4));
      console.log(JSON.stringify(performanceBenchmark.stats('Blocks'), null, 4));
    });
  });

  after(async () => {
    await nf3Proposer1.deregisterProposer();
    await nf3Proposer1.close();
    await nf3Users[0].close();
    await web3Client.closeWeb3();
  });
});
