import chai from 'chai';
import chaiHttp from 'chai-http';
import chaiAsPromised from 'chai-as-promised';
import config from 'config';
import Nf3 from '../../cli/lib/nf3.mjs';
import {
  getBalance,
  connectWeb3,
  closeWeb3Connection,
  topicEventMapping,
  timeJump,
} from '../utils.mjs';
import { generateKeys } from '../../nightfall-client/src/services/keys.mjs';

const { BLOCKCHAIN_TESTNET_URL } = process.env;

const { expect } = chai;
chai.use(chaiHttp);
chai.use(chaiAsPromised);

describe('Testing the Nightfall SDK', () => {
  const ethereumSigningKey = '0x4775af73d6dc84a0ae76f8726bda4b9ecf187c377229cb39e1afa7a18236a69e';
  const nf3 = new Nf3(
    'http://localhost:8080',
    'http://localhost:8081',
    'ws://localhost:8082',
    'ws://localhost:8546',
    ethereumSigningKey,
  );

  const { ZKP_KEY_LENGTH } = config;
  let web3;
  let ercAddress;
  let stateAddress;
  const txPerBlock = 2;
  const tokenId = '0x00';
  const tokenType = 'ERC20'; // it can be 'ERC721' or 'ERC1155'
  const value = 10;
  const fee = 1;
  const eventLogs = [];
  let pkd2;
  let nodeInfo;
  const transactions = [];

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  before(async () => {
    // to enable getBalance with web3 we should connect first
    web3 = await connectWeb3(BLOCKCHAIN_TESTNET_URL);
    stateAddress = await nf3.getContractAddress('State');

    await nf3.init();
    if (!(await nf3.healthcheck('optimist'))) throw new Error('Healthcheck failed');
    // Proposer registration
    await nf3.registerProposer();
    // Proposer listening for incoming events
    nf3.startProposer();
    // Challenger registration
    await nf3.registerChallenger();
    // Chalenger listening for incoming events
    nf3.startChallenger();
    // Liquidity provider for instant withdraws
    const emitter = await nf3.getInstantWithdrawalRequestedEmitter();
    emitter.on('data', async (withdrawTransactionHash, paidBy, amount) => {
      await nf3.advanceInstantWithdrawal(withdrawTransactionHash);
      console.log(`Serviced instant-withdrawal request from ${paidBy}, with fee ${amount}`);
    });

    ({ pkd: pkd2 } = await generateKeys(ZKP_KEY_LENGTH));

    nodeInfo = await web3.eth.getNodeInfo();

    web3.eth.subscribe('logs', { address: stateAddress }).on('data', log => {
      // For event tracking, we use only care about the logs related to 'blockProposed'
      if (log.topics[0] === topicEventMapping.BlockProposed) eventLogs.push('blockProposed');
    });
  });

  describe('Miscellaneous tests', () => {
    it('should respond with "true" the health check', async function () {
      const res = await nf3.healthcheck('optimist');
      expect(res).to.be.equal(true);
    });

    it('should get the address of the shield contract', async function () {
      const res = await nf3.getContractAddress('Shield');
      expect(res).to.be.a('string').and.to.include('0x');
    });

    it('should get the address of the test ERC contract stub', async function () {
      const res = await nf3.getContractAddress('ERCStub');
      ercAddress = res;
      expect(res).to.be.a('string').and.to.include('0x');
    });

    it('should subscribe to block proposed event with the provided incoming viewing key for client', async function () {
      const res = await nf3.subscribeToIncomingViewingKeys();
      expect(res.data.status).to.be.a('string');
      expect(res.data.status).to.be.equal('success');
    });
  });

  describe('Basic Proposer tests', () => {
    it('should register a proposer', async () => {
      // we have to pay 10 ETH to be registered
      const bond = 10;
      const gasCosts = 5000000000000000;
      const startBalance = await getBalance(nf3.ethereumAddress);
      const res = await nf3.registerProposer();
      const endBalance = await getBalance(nf3.ethereumAddress);

      expect(res).to.have.property('transactionHash');
      expect(res).to.have.property('blockHash');
      expect(endBalance - startBalance).to.closeTo(-bond, gasCosts);
    });

    it('should de-register a proposer', async () => {
      let proposers;
      ({ proposers } = await nf3.getProposers());
      let thisProposer = proposers.filter(p => p.thisAddress === nf3.ethereumAddress);
      expect(thisProposer.length).to.be.equal(1);
      const res = await nf3.deregisterProposer();
      expect(res).to.have.property('transactionHash');
      ({ proposers } = await nf3.getProposers());
      thisProposer = proposers.filter(p => p.thisAddress === nf3.ethereumAddress);
      expect(thisProposer.length).to.be.equal(0);
    });

    it('Should create a failing withdrawBond (because insufficient time has passed)', async () => {
      let error = null;
      try {
        await nf3.withdrawBond();
      } catch (err) {
        error = err;
      }
      console.log(error.message);
      expect(error.message).to.be.equal(
        'Returned error: VM Exception while processing transaction: revert It is too soon to withdraw your bond',
      );
    });

    it('Should create a passing withdrawBond (because sufficient time has passed)', async () => {
      if (nodeInfo.includes('TestRPC')) await timeJump(3600 * 24 * 10); // jump in time by 7 days
      if (nodeInfo.includes('TestRPC')) {
        const res = await nf3.withdrawBond();
        expect(res).to.have.property('transactionHash');
        expect(res).to.have.property('blockHash');
      } else {
        let error = null;
        try {
          await nf3.withdrawBond();
        } catch (err) {
          error = err;
        }
        expect(error.message).to.be.equal('Transaction has been reverted by the EVM');
      }
    });

    after(async () => {
      // After the proposer tests, re-register proposers
      await nf3.registerProposer();
    });
  });

  describe('Basic Challenger tests', () => {
    it('should register a challenger', async () => {
      const res = await nf3.registerChallenger();
      expect(res.status).to.be.equal(200);
    });

    it('should de-register a challenger', async () => {
      const res = await nf3.deregisterChallenger();
      expect(res.status).to.be.equal(200);
    });

    after(async () => {
      // After the challenger tests, re-register challenger
      await nf3.registerChallenger();
    });
  });

  describe('Deposit tests', () => {
    // Need at least 5 deposits to perform all the necessary transfers
    // set the number of deposit transactions blocks to perform.
    const numDeposits = txPerBlock >= 5 ? 1 : Math.ceil(5 / txPerBlock);

    it('should deposit some crypto into a ZKP commitment', async function () {
      // We create enough transactions to fill numDeposits blocks full of deposits.
      const depositTransactions = [];
      for (let i = 0; i < txPerBlock * numDeposits; i++) {
        // eslint-disable-next-line no-await-in-loop
        const res = await nf3.deposit(ercAddress, tokenType, value, tokenId, fee);
        expect(res).to.have.property('transactionHash');
        expect(res).to.have.property('blockHash');
        depositTransactions.push(res);
      }

      const totalGas = depositTransactions.reduce((acc, { gasUsed }) => acc + Number(gasUsed), 0);

      console.log(`     Average Gas used was ${Math.ceil(totalGas / (txPerBlock * numDeposits))}`);

      // Wait until we see the right number of blocks appear
      while (eventLogs.length !== numDeposits) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      // Now we can empty the event queue
      for (let i = 0; i < numDeposits; i++) {
        eventLogs.shift();
      }
    });
  });

  describe('Balance tests', () => {
    it('should increment the balance after deposit some crypto', async function () {
      await sleep(5000);
      let balances = await nf3.getLayer2Balances();
      const currentPkdBalance = balances[nf3.zkpKeys.pkd[1]][BigInt(ercAddress).toString(16)];
      // We do 2 deposits of 10 each
      for (let i = 0; i < txPerBlock; i++) {
        // eslint-disable-next-line no-await-in-loop
        const res = await nf3.deposit(ercAddress, tokenType, value, tokenId, fee);
        expect(res).to.have.property('transactionHash');
        expect(res).to.have.property('blockHash');
      }
      // Wait until we see the right number of blocks appear
      while (eventLogs[0] !== 'blockProposed') {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      eventLogs.shift();
      balances = await nf3.getLayer2Balances();
      const afterPkdBalance = balances[nf3.zkpKeys.pkd[1]][BigInt(ercAddress).toString(16)];
      expect(afterPkdBalance - currentPkdBalance).to.be.equal(20);
    });

    it('should decrement the balance after transfer to other wallet and increment the other wallet', async function () {
      let res;
      for (let i = 0; i < txPerBlock; i++) {
        // eslint-disable-next-line no-await-in-loop
        res = await nf3.deposit(ercAddress, tokenType, value, tokenId, fee);
        expect(res).to.have.property('transactionHash');
        expect(res).to.have.property('blockHash');
      }
      while (eventLogs[0] !== 'blockProposed') {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      eventLogs.shift();

      let balances = await nf3.getLayer2Balances();
      // console.log('BEFORE:', balances);
      const currentPkdBalancePkd = balances[nf3.zkpKeys.pkd[1]][BigInt(ercAddress).toString(16)];
      const currentPkdBalancePkd2 = balances[pkd2][BigInt(ercAddress).toString(16)];
      for (let i = 0; i < txPerBlock; i++) {
        // console.log('T(1)');
        // eslint-disable-next-line no-await-in-loop
        res = await nf3.transfer(false, ercAddress, tokenType, value, tokenId, pkd2, fee);
        // console.log('T(2)');
        expect(res).to.have.property('transactionHash');
        expect(res).to.have.property('blockHash');
      }
      // Wait until we see the right number of blocks appear
      while (eventLogs[0] !== 'blockProposed') {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      eventLogs.shift();
      balances = await nf3.getLayer2Balances();
      // console.log('AFTER:', balances);
      const afterPkdBalancePkd = balances[nf3.zkpKeys.pkd[1]][BigInt(ercAddress).toString(16)];
      const afterPkdBalancePkd2 = balances[pkd2][BigInt(ercAddress).toString(16)];
      expect(afterPkdBalancePkd - currentPkdBalancePkd).to.be.equal(-20);
      expect(afterPkdBalancePkd2 - currentPkdBalancePkd2).to.be.equal(20);
    });
  });

  // now we have some deposited tokens, we can transfer one of them:
  describe('Single transfer tests', () => {
    it('should transfer some crypto (back to us) using ZKP', async function () {
      const res = await nf3.transfer(
        false,
        ercAddress,
        tokenType,
        value,
        tokenId,
        nf3.zkpKeys.pkd,
        fee,
      );
      expect(res).to.have.property('transactionHash');
      expect(res).to.have.property('blockHash');
      console.log(`     Gas used was ${Number(res.gasUsed)}`);
    });

    it('should send a single transfer directly to a proposer - offchain and a receiver different from the sender should successfully receive that transfer', async function () {
      const res = await nf3.transfer(true, ercAddress, tokenType, value, tokenId, pkd2, fee);
      expect(res).to.be.equal(200);

      const depositTransactions = [];
      for (let i = 0; i < txPerBlock; i++) {
        // eslint-disable-next-line no-await-in-loop
        depositTransactions.push(await nf3.deposit(ercAddress, tokenType, value, tokenId, fee));
      }
      depositTransactions.forEach(receipt => {
        expect(receipt).to.have.property('transactionHash');
        expect(receipt).to.have.property('blockHash');
      });

      // wait for the block proposed event with transfer function to be recognised by nightfall client of recipient
      while (eventLogs.length !== 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      eventLogs.shift();
    });
  });

  describe('Withdraw tests', () => {
    it('should withdraw some crypto from a ZKP commitment', async function () {
      const res = await nf3.withdraw(
        false,
        ercAddress,
        tokenType,
        value,
        tokenId,
        nf3.ethereumAddress,
      );
      expect(res).to.have.property('withdrawTransactionHash');
      const restx = await res.receiptPromise; // wait for the promise tx to end
      transactions.push(restx.transactionHash); // the new transaction
      expect(restx).to.have.property('transactionHash');
      expect(restx).to.have.property('blockHash');
      console.log(`     Gas used was ${Number(restx.gasUsed)}`);

      const depositTransactions = [];
      for (let i = 0; i < txPerBlock - 1; i++) {
        // eslint-disable-next-line no-await-in-loop
        depositTransactions.push(await nf3.deposit(ercAddress, tokenType, value, tokenId, fee));
      }

      depositTransactions.forEach(receipt => {
        expect(receipt).to.have.property('transactionHash');
        expect(receipt).to.have.property('blockHash');
      });

      while (eventLogs[0] !== 'blockProposed') {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      eventLogs.shift();
    });

    it('should allow instant withdraw of existing withdraw', async function () {
      // We create enough transactions to fill numDeposits blocks full of deposits.
      let depositTransactions = [];
      for (let i = 0; i < txPerBlock; i++) {
        // eslint-disable-next-line no-await-in-loop
        depositTransactions.push(await nf3.deposit(ercAddress, tokenType, value, tokenId, fee));
      }

      depositTransactions.forEach(receipt => {
        expect(receipt).to.have.property('transactionHash');
        expect(receipt).to.have.property('blockHash');
      });

      while (eventLogs[0] !== 'blockProposed') {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      eventLogs.shift();

      let latestWithdrawTransactionHash = ''; // for instant withdrawals
      ({ withdrawTransactionHash: latestWithdrawTransactionHash } = await nf3.withdraw(
        false,
        ercAddress,
        tokenType,
        value,
        tokenId,
        nf3.ethereumAddress,
        fee,
      ));
      expect(latestWithdrawTransactionHash).to.be.a('string').and.to.include('0x');

      depositTransactions = [];
      for (let i = 0; i < txPerBlock - 1; i++) {
        // eslint-disable-next-line no-await-in-loop
        depositTransactions.push(await nf3.deposit(ercAddress, tokenType, value, tokenId, fee));
      }

      depositTransactions.forEach(receipt => {
        expect(receipt).to.have.property('transactionHash');
        expect(receipt).to.have.property('blockHash');
      });

      while (eventLogs[0] !== 'blockProposed') {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      eventLogs.shift();

      const res = await nf3.requestInstantWithdrawal(latestWithdrawTransactionHash, fee);
      expect(res).to.have.property('transactionHash');
      expect(res).to.have.property('blockHash');
      console.log(`     Gas used was ${Number(res.gasUsed)}`);

      depositTransactions = [];
      for (let i = 0; i < txPerBlock; i++) {
        // eslint-disable-next-line no-await-in-loop
        depositTransactions.push(await nf3.deposit(ercAddress, tokenType, value, tokenId, fee));
      }

      depositTransactions.forEach(receipt => {
        expect(receipt).to.have.property('transactionHash');
        expect(receipt).to.have.property('blockHash');
      });

      while (eventLogs[0] !== 'blockProposed') {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      eventLogs.shift();
    });

    it('should not allow instant withdraw of non existing withdraw or not in block yet', async function () {
      // We create enough transactions to fill numDeposits blocks full of deposits.
      let latestWithdrawTransactionHash = ''; // for instant withdrawals
      ({ withdrawTransactionHash: latestWithdrawTransactionHash } = await nf3.withdraw(
        false,
        ercAddress,
        tokenType,
        value,
        tokenId,
        nf3.ethereumAddress,
        fee,
      ));
      expect(latestWithdrawTransactionHash).to.be.a('string').and.to.include('0x');

      let error;
      try {
        const res = await nf3.requestInstantWithdrawal(latestWithdrawTransactionHash, fee);
        expect(res).to.have.property('transactionHash');
        expect(res).to.have.property('blockHash');
      } catch (e) {
        error = e;
      }
      expect(error.response.status).to.be.equal(500);
    });
  });

  // when the widthdraw transaction is finalised, we want to be able to pull the
  // funds into layer1
  describe('Withdraw funds to layer 1', () => {
    let startBalance;
    let endBalance;
    it('Should create a failing finalise-withdrawal (because insufficient time has passed)', async function () {
      let error = null;
      try {
        const res = await nf3.finaliseWithdrawal(transactions[0]);
        expect(res).to.have.property('transactionHash');
        expect(res).to.have.property('blockHash');
      } catch (err) {
        error = err;
      }
      console.log(error.message);
      expect(error.message).to.be.equal(
        'Returned error: VM Exception while processing transaction: revert It is too soon to withdraw funds from this block',
      );
    });

    it('Should create a passing finalise-withdrawal with a time-jump capable test client (because sufficient time has passed)', async function () {
      if (nodeInfo.includes('TestRPC')) await timeJump(3600 * 24 * 10); // jump in time by 10 days

      startBalance = await getBalance(nf3.ethereumAddress);
      // now we need to sign the transaction and send it to the blockchain
      // this will only work if we're using Ganache, otherwiise expect failure
      if (nodeInfo.includes('TestRPC')) {
        const res = await nf3.finaliseWithdrawal(transactions[0]);
        expect(res).to.have.property('transactionHash');
        expect(res).to.have.property('blockHash');
      } else {
        let error = null;
        try {
          const res = await nf3.finaliseWithdrawal(transactions[0]);
          expect(res).to.have.property('transactionHash');
          expect(res).to.have.property('blockHash');
        } catch (err) {
          error = err;
        }
        console.log(error.message);
        expect(error.message).to.be.equal('Transaction has been reverted by the EVM');
      }
      endBalance = await getBalance(nf3.ethereumAddress);
    });

    it('Should have increased our balance', async function () {
      if (nodeInfo.includes('TestRPC')) {
        const gasCosts = (5000000000000000 * txPerBlock) / 2;
        expect(endBalance - startBalance).to.closeTo(Number(value), gasCosts);
      } else {
        console.log('Not using a time-jump capable test client so this test is skipped');
        this.skip();
      }
    });
  });

  after(() => {
    nf3.close();
    closeWeb3Connection();
  });
});
