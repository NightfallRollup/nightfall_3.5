/* eslint-disable import/no-cycle */
import config from 'config';
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import Timber from '@polygon-nightfall/common-files/classes/timber.mjs';
import constants from '@polygon-nightfall/common-files/constants/index.mjs';
import { getCircuitHash } from '@polygon-nightfall/common-files/utils/worker-calls.mjs';
import { getTimeByBlock } from '@polygon-nightfall/common-files/utils/block-utils.mjs';
import gen from 'general-number';
import * as pm from '@polygon-nightfall/common-files/utils/stats.mjs';
import {
  markNullifiedOnChain,
  markOnChain,
  countCommitments,
  // getCommitmentsByHash,
  countNullifiers,
  setSiblingInfo,
  getCircuitTransactionsByHash,
} from '../services/commitment-storage.mjs';
import getProposeBlockCalldata from '../services/process-calldata.mjs';
import { zkpPrivateKeys, nullifierKeys } from '../services/keys.mjs';
import {
  getTreeByBlockNumberL2,
  saveTree,
  saveTransaction,
  saveBlock,
  setTransactionHashSiblingInfo,
  getNumberOfL2Blocks,
} from '../services/database.mjs';
import { decryptCommitment } from '../services/commitment-sync.mjs';
import { syncState } from '../services/state-sync.mjs';

const { TIMBER_HEIGHT, HASH_TYPE, TXHASH_TREE_HASH_TYPE } = config;
const { ZERO, WITHDRAW } = constants;

const { generalise } = gen;

const circuitHash = await getCircuitHash(WITHDRAW);

const withdrawCircuitHash = generalise(circuitHash).hex(32);

// Stores latest L1 block correctly synchronized to speed possible resyncs
let lastInOrderL1Block = 'earliest';
// Counter to monitor resync attempts in case something is wrong we can force a
//   full resync
let consecutiveResyncAttempts = 0;

// Decrypt transactions in block
export async function processTransactions(
  transactions,
  transactionHashL1,
  block,
  timeBlockL2,
  data,
) {
  const dbUpdates = transactions.map(async transaction => {
    let saveTxToDb = false;

    // filter out non zero commitments and nullifiers
    const nonZeroCommitments = transaction.commitments.filter(c => c !== ZERO);
    const nonZeroNullifiers = transaction.nullifiers.filter(n => n !== ZERO);

    const [countOfNonZeroCommitments, countOfNonZeroNullifiers] = await Promise.all([
      countCommitments([nonZeroCommitments[0]]),
      countNullifiers(nonZeroNullifiers),
    ]);

    let isDecrypted = false;
    // In order to check if the transaction is a transfer, we check if the compressed secrets
    // are different than zero. All other transaction types have compressedSecrets = [0,0]
    if (
      (transaction.compressedSecrets[0] !== ZERO || transaction.compressedSecrets[1] !== ZERO) &&
      !countOfNonZeroCommitments
    ) {
      const transactionDecrypted = await decryptCommitment(
        transaction,
        zkpPrivateKeys,
        nullifierKeys,
      );
      if (transactionDecrypted) {
        saveTxToDb = true;
        isDecrypted = true;
      }
    }

    if (countOfNonZeroCommitments >= 1 || countOfNonZeroNullifiers >= 1) {
      saveTxToDb = true;
    }

    logger.trace({
      transaction: transaction.transactionHash,
      saveTxToDb,
      countOfNonZeroCommitments,
      countOfNonZeroNullifiers,
    });

    if (saveTxToDb) {
      logger.info({ msg: 'Saving transaction', transaction: transaction.transactionHash });
      await saveTransaction({
        transactionHashL1,
        blockNumber: data.blockNumber,
        blockNumberL2: block.blockNumberL2,
        timeBlockL2,
        ...transaction,
        isDecrypted,
      });
    }

    return Promise.all([
      saveTxToDb,
      markOnChain(nonZeroCommitments, block.blockNumberL2, data.blockNumber, data.transactionHash),
      markNullifiedOnChain(
        nonZeroNullifiers,
        block.blockNumberL2,
        data.blockNumber,
        data.transactionHash,
      ),
    ]);
  });
  return dbUpdates;
}

// Write updated sibling info to commitment
async function updateCommitmentSiblingInfo(blockCommitments, latestTree, updatedTimberRoot) {
  /*
  const myCommitments = (await getCommitmentsByHash(blockCommitments)).map(c => c._id);
  if (myCommitments.length === 0) return;

  const tmpTree = Timber.statelessSiblingPathInit(
    latestTree,
    blockCommitments,
    HASH_TYPE,
    TIMBER_HEIGHT,
  );
  await Promise.all(
    // eslint-disable-next-line consistent-return
    blockCommitments.map(async (c, i) => {
      if (myCommitments.includes(c)) {
        const siblingPath = Timber.statelessSiblingPathFinal(
          latestTree,
          blockCommitments,
          i,
          tmpTree,
        );
        return setSiblingInfo(c, siblingPath, latestTree.leafCount + i, updatedTimberRoot);
      }
    }),
  );
  */
  await Promise.all(
    // eslint-disable-next-line consistent-return
    blockCommitments.map(async (c, i) => {
      const count = await countCommitments([c]);
      if (count > 0) {
        const siblingPath = Timber.statelessSiblingPath(
          latestTree,
          blockCommitments,
          i,
          HASH_TYPE,
          TIMBER_HEIGHT,
        );
        return setSiblingInfo(c, siblingPath, latestTree.leafCount + i, updatedTimberRoot);
      }
    }),
  );
}

async function updateWithdrawSiblingInfo(block) {
  // If this L2 block contains withdraw transactions known to this client,
  // the following needs to be saved for later to be used during finalise/instant withdraw
  // 1. Save sibling path for the withdraw transaction hash that is present in transaction hashes timber tree
  // 2. Save transactions hash of the transactions in this L2 block that contains withdraw transactions for this client
  // transactions hash is a linear hash of the transactions in an L2 block which is calculated during proposeBlock in
  // the contract
  let height = 1;
  while (2 ** height < block.transactionHashes.length) {
    ++height;
  }

  const withdrawTransactionHashes = (
    await getCircuitTransactionsByHash(block.transactionHashes, withdrawCircuitHash)
  ).map(t => t.transactionHash);
  if (withdrawTransactionHashes.length > 0) {
    const transactionHashesTimber = new Timber(...[, , , ,], TXHASH_TREE_HASH_TYPE, height);
    const updatedTransactionHashesTimber = Timber.statelessUpdate(
      transactionHashesTimber,
      block.transactionHashes,
      TXHASH_TREE_HASH_TYPE,
      height,
    );

    await Promise.all(
      // eslint-disable-next-line consistent-return
      block.transactionHashes.map(async (transactionHash, i) => {
        if (withdrawTransactionHashes.includes(transactionHash)) {
          const siblingPathTransactionHash =
            updatedTransactionHashesTimber.getSiblingPath(transactionHash);
          return setTransactionHashSiblingInfo(
            transactionHash,
            siblingPathTransactionHash,
            transactionHashesTimber.leafCount + i,
            updatedTransactionHashesTimber.root,
          );
        }
      }),
    );
  }
}

async function storeTree(latestTree, blockCommitments, transactionHashL1, block, syncing) {
  // Build and save updated tree
  const updatedTimber = Timber.statelessUpdate(
    latestTree,
    blockCommitments,
    HASH_TYPE,
    TIMBER_HEIGHT,
  );

  try {
    await saveTree(transactionHashL1, block.blockNumberL2, updatedTimber);
  } catch (err) {
    // while initial syncing we avoid duplicates errors
    if (!syncing || !err.message.includes('duplicate key')) throw err;
  }

  logger.debug({
    msg: 'Saved tree for L2 block',
    blockNumberL2: block.blockNumberL2,
  });

  return updatedTimber;
}

/**
 * This handler runs whenever a BlockProposed event is emitted by the blockchain
 */
export async function blockProposedEventHandler(data, syncing) {
  pm.start('blockProposedEventHandler');
  // zkpPrivateKey will be used to decrypt secrets whilst nullifierKey will be used to calculate nullifiers for commitments and store them
  const { blockNumber: currentBlockCount, transactionHash: transactionHashL1 } = data;
  const { transactions, block } = await getProposeBlockCalldata(data);
  const nextBlockNumberL2 = await getNumberOfL2Blocks();

  logger.info({
    msg: 'Received Block Proposed event with Layer 2 Block Number and Tx Hash',
    receivedBlockNumberL2: block.blockNumberL2,
    expectedBlockNumberL2: nextBlockNumberL2,
    transactionHashL1,
  });

  // Check resync attempts
  if (consecutiveResyncAttempts > 10) {
    lastInOrderL1Block = 'earliest';
    consecutiveResyncAttempts = 0;
  }

  // If an out of order L2 block is detected,
  if (block.blockNumberL2 > nextBlockNumberL2) {
    consecutiveResyncAttempts++;
    // TODO set syncing state to true to disable endpoint temporarily
    await syncState(lastInOrderL1Block);
  }

  lastInOrderL1Block = currentBlockCount;
  const latestTree = await getTreeByBlockNumberL2(block.blockNumberL2 - 1);

  const blockCommitments = transactions
    .map(t => t.commitments.filter(c => c !== ZERO))
    .flat(Infinity);

  let timeBlockL2 = await getTimeByBlock(transactionHashL1);
  timeBlockL2 = new Date(timeBlockL2 * 1000);

  pm.start('blockProposedEventHandler - processTransactions');
  // process transactions in block
  const dbUpdates = await processTransactions(
    transactions,
    transactionHashL1,
    block,
    timeBlockL2,
    data,
  );
  pm.stop('blockProposedEventHandler - processTransactions');

  pm.start('blockProposedEventHandler - saveBlock');
  await Promise.all(dbUpdates).then(async updateReturn => {
    // only save block if any transaction in it is saved/stored to db
    const saveBlockToDb = updateReturn.map(d => d[0]);
    if (saveBlockToDb.includes(true)) {
      saveBlock({ blockNumber: currentBlockCount, transactionHashL1, timeBlockL2, ...block });
    }
  });
  pm.stop('blockProposedEventHandler - saveBlock');

  pm.start('blockProposedEventHandler - storeTree');
  // compute and store tree
  const updatedTimber = await storeTree(
    latestTree,
    blockCommitments,
    transactionHashL1,
    block,
    syncing,
  );
  pm.start('blockProposedEventHandler - stopTree');

  pm.start('blockProposedEventHandler - updateCommitmentsSiblingInfo');
  // Update sibling information in commitments
  await updateCommitmentSiblingInfo(blockCommitments, latestTree, updatedTimber.root);
  pm.stop('blockProposedEventHandler - updateCommitmentsSiblingInfo');

  pm.start('blockProposedEventHandler - updateWithdrawalSiblingInfo');
  // update sibling information in withdraw transactions
  await updateWithdrawSiblingInfo(block);
  pm.stop('blockProposedEventHandler - updateWithdrawalSiblingInfo');
  pm.stop('blockProposedEventHandler');
}
