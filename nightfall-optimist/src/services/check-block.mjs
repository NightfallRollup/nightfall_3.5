/**
Module to check that submitted Blocks and Transactions are valid
*/
import axios from 'axios';
import config from 'config';
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import constants from '@polygon-nightfall/common-files/constants/index.mjs';
import { enqueueEvent } from '@polygon-nightfall/common-files/utils/event-queue.mjs';
import { BlockError, Transaction } from '../classes/index.mjs';
import {
  getBlockByBlockNumberL2,
  getTransactionHashSiblingInfo,
  getTreeByBlockNumberL2,
  getTreeByLeafCount,
  getAllRegisteredProposers,
  saveInvalidBlock,
  getTransactionByBlockNumberL2,
} from './database.mjs';
import Block from '../classes/block.mjs';
import { increaseBlockInvalidCounter } from './debug-counters.mjs';
import { createChallenge, commitToChallenge } from './challenges.mjs';
import { checkTransaction } from './transaction-checker.mjs';
import { workerEnableGet } from '../event-handlers/transaction-submitted.mjs';

const { ZERO } = constants;
const { txWorkerUrl } = config.TX_WORKER_PARAMS;

/**
 * Check that the leafCount is correct
 * we do this first because subsequent checks are reliant on the leafCount
 * being correct!
 * We need to get hold of the prior block to do this because the leafCount
 * is derrived from data in that block.
 */
async function checkLeafCount(block) {
  logger.debug(`Checking block with leafCount ${block.leafCount}`);
  const currentBlock = await getBlockByBlockNumberL2(block.blockNumberL2);

  if (block.blockNumberL2 > 0) {
    const priorBlock = await getBlockByBlockNumberL2(block.blockNumberL2 - 1);
    if (priorBlock === null) logger.warn('Could not find prior block while checking leaf count');
    if (priorBlock.leafCount + currentBlock.nCommitments !== block.leafCount)
      throw new BlockError('The leaf count in the block is not correct', 0);
  } else if (currentBlock.nCommitments !== block.leafCount) {
    // this throws if it's the first block and leafCount!=0, which is impossible
    throw new BlockError('The leaf count in the block is not correct', 0);
  }
}

// There's a bit of an issue here though.  It's possible that our block didn't
// add any new leaves to Timber if it's a block with just withdrawals in.
// In this case, Timber won't update its DB and consequently won't write a
// new history. To check the block in this case, we make sure the root isn't
// changed from the previous block.
async function checkBlockRoot(block) {
  let history; // this could end up being a Block or Timber history object - as they both have root properties, that's fine.
  if (block.nCommitments === 0) {
    history = await getBlockByBlockNumberL2(block.blockNumberL2 - 1);
    logger.debug('Block has no commitments - checking its root is the same as the previous block');
  } else {
    while (!history) {
      // eslint-disable-next-line no-await-in-loop
      history = await getTreeByLeafCount(block.leafCount);
      logger.debug(`Block has commitments - retrieved history from Timber`);
      logger.trace({
        msg: 'Timber history was',
        history,
      });

      // eslint-disable-next-line no-await-in-loop
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  if (history.root !== block.root) {
    throw new BlockError(
      `The block's root (${block.root}) cannot be reconstructed from the commitment hashes in the transactions in this block and the historic Frontier held by Timber for this root`,
      1,
    );
  }
}

async function checkFrontier(block) {
  const tree = await getTreeByBlockNumberL2(block.blockNumberL2);
  const frontierHash = await Block.calcFrontierHash(tree.frontier);
  if (frontierHash !== block.frontierHash)
    throw new BlockError(
      `The block's frontier hash (${block.frontierHash}) does not match with the frontier corresponding to this block stored in Timber`,
      6,
    );
}

// check if there are duplicate commitments in different transactions of the same block
async function checkDuplicateCommitmentsWithinBlock(block, transactions) {
  // Create an array containing all the commitments different than zero in a block and also the transaction index in which belongs to
  const blockCommitments = transactions
    .map((transaction, i) =>
      transaction.commitments
        .filter(c => c !== ZERO)
        .map(c => {
          return { transactionIndex: i, commitment: c };
        }),
    )
    .flat(Infinity);
  let index1 = 0;
  let index2 = 0;
  for (let index = 0; index < blockCommitments.length; ++index) {
    // The idea here is to check if all commitments in a block are unique. To do so, we get the last index of each commitment
    // and if it doesn't match with the current loop index means that there is more than one instance.
    const lastIndex = blockCommitments
      .map(c => c.commitment)
      .lastIndexOf(blockCommitments[index].commitment);

    if (index !== lastIndex) {
      index1 = index;
      index2 = lastIndex;
      break;
    }
  }

  // If index2 is different than zero means that the loop above was exited due to a duplicated commitment.
  // Note that we cannot check the first index (index1) since it is possible that it was pointing to the first element of the array (so index1 can be 0)
  if (index2 !== 0) {
    const transaction1Index = blockCommitments[index1].transactionIndex;
    const transaction1Hash = Transaction.calcHash(transactions[transaction1Index]);
    let siblingPath1 = (await getTransactionHashSiblingInfo(transaction1Hash))
      .transactionHashSiblingPath;

    if (!siblingPath1) {
      await Block.calcTransactionHashesRoot(transactions);
      siblingPath1 = (await getTransactionHashSiblingInfo(transaction1Hash))
        .transactionHashSiblingPath;
    }

    const transaction2Index = blockCommitments[index2].transactionIndex;
    const transaction2Hash = Transaction.calcHash(transactions[transaction2Index]);
    let siblingPath2 = (await getTransactionHashSiblingInfo(transaction2Hash))
      .transactionHashSiblingPath;

    if (!siblingPath2) {
      await Block.calcTransactionHashesRoot(transactions);
      siblingPath2 = (await getTransactionHashSiblingInfo(transaction2Hash))
        .transactionHashSiblingPath;
    }

    throw new BlockError(
      `The block check failed due to duplicate commitments in different transactions of the same block`,
      2,
      {
        block1: block,
        transaction1: transactions[transaction1Index],
        transaction1Index,
        siblingPath1,
        duplicateCommitment1Index: transactions[transaction1Index].commitments.indexOf(
          blockCommitments[index1].commitment,
        ),
        block2: block,
        transaction2: transactions[transaction2Index],
        transaction2Index,
        siblingPath2,
        duplicateCommitment2Index: transactions[transaction2Index].commitments.indexOf(
          blockCommitments[index1].commitment,
        ),
      },
    );
  }
}

// check if there are duplicate nullifiers in different transactions of the same block
async function checkDuplicateNullifiersWithinBlock(block, transactions) {
  // Create an array containing all the nullifiers different than zero in a block and also the transaction index in which belongs to
  const blockNullifiers = transactions
    .map((transaction, i) =>
      transaction.nullifiers
        .filter(n => n !== ZERO)
        .map(n => {
          return { transactionIndex: i, nullifier: n };
        }),
    )
    .flat(Infinity);

  let index1 = 0;
  let index2 = 0;
  for (let index = 0; index < blockNullifiers.length; ++index) {
    // The idea here is to check if all nullifiers in a block are unique. To do so, we get the last index of each nullifier
    // and if it doesn't match with the current loop index means that there is more than one instance.
    const lastIndex = blockNullifiers
      .map(n => n.nullifier)
      .lastIndexOf(blockNullifiers[index].nullifier);

    if (index !== lastIndex) {
      index1 = index;
      index2 = lastIndex;
      break;
    }
  }

  // If index2 is different than zero means that the loop above was exited due to a duplicated nullifier.
  // Note that we cannot check the first index (index1) since it is possible that it was pointing to the first element of the array (so index1 can be 0)
  if (index2 !== 0) {
    const transaction1Index = blockNullifiers[index1].transactionIndex;
    const transaction1Hash = Transaction.calcHash(transactions[transaction1Index]);
    let siblingPath1 = (await getTransactionHashSiblingInfo(transaction1Hash))
      .transactionHashSiblingPath;

    if (!siblingPath1) {
      await Block.calcTransactionHashesRoot(transactions);
      siblingPath1 = (await getTransactionHashSiblingInfo(transaction1Hash))
        .transactionHashSiblingPath;
    }

    const transaction2Index = blockNullifiers[index2].transactionIndex;
    const transaction2Hash = Transaction.calcHash(transactions[transaction2Index]);
    let siblingPath2 = (await getTransactionHashSiblingInfo(transaction2Hash))
      .transactionHashSiblingPath;

    if (!siblingPath2) {
      await Block.calcTransactionHashesRoot(transactions);
      siblingPath2 = (await getTransactionHashSiblingInfo(transaction2Hash))
        .transactionHashSiblingPath;
    }

    throw new BlockError(
      `The block check failed due to duplicate nullifiers in different transactions of the same block`,
      3,
      {
        block1: block,
        transaction1: transactions[transaction1Index],
        transaction1Index,
        siblingPath1,
        duplicateNullifier1Index: transactions[transaction1Index].nullifiers.indexOf(
          blockNullifiers[index1].nullifier,
        ),
        block2: block,
        transaction2: transactions[transaction2Index],
        transaction2Index,
        siblingPath2,
        duplicateNullifier2Index: transactions[transaction2Index].nullifiers.indexOf(
          blockNullifiers[index1].nullifier,
        ),
      },
    );
  }
}

async function buildErrorMessage(err, block, transactions, transaction) {
  const newError = { ...err };
  if (newError.code === 0 || newError.code === 1) {
    let siblingPath1 = (await getTransactionHashSiblingInfo(transaction.transactionHash))
      .transactionHashSiblingPath;
    // case when block.build never was called
    // may be this optimist never ran as proposer
    // or more likely since this tx is bad tx from a bad proposer.
    // prposer hosted in this optimist never build any block with this bad tx in it
    if (!siblingPath1) {
      await Block.calcTransactionHashesRoot(transactions);
      siblingPath1 = (await getTransactionHashSiblingInfo(transaction.transactionHash))
        .transactionHashSiblingPath;
    }
    // case when block.build never was called
    // may be this optimist never ran as proposer
    if (!newError.metadata.siblingPath2) {
      await Block.calcTransactionHashesRoot(
        newError.metadata.block2.transactionHashes.map(transactionHash => {
          return { transactionHash };
        }),
      );
      newError.metadata.siblingPath2 = (
        await getTransactionHashSiblingInfo(newError.metadata.transaction2.transactionHash)
      ).transactionHashSiblingPath;
    }

    newError.metadata = {
      ...newError.metadata,
      block1: block,
      transaction1: transaction,
      transaction1Index: block.transactionHashes.indexOf(transaction.transactionHash),
      siblingPath1,
    };
  }
  return newError;
}

async function createAndCommitChallenge(newError, transaction, block) {
  const err = new BlockError(
    `The transaction check failed with error: ${newError.message}`,
    Number(newError.code) + 2, // mapping transaction error to block error
    {
      ...newError.metadata,
      transactionHashIndex: block.transactionHashes.indexOf(transaction.transactionHash),
    },
  );
  logger.warn(`Block Checker - Block invalid, with code ${err.code}! ${err.message}`);
  logger.info(`Block is invalid, stopping any block production`);
  // We enqueue an event onto the stopQueue to halt block production.
  // This message will not be printed because event dequeuing does not run the job.
  // This is fine as we are just using it to stop running.
  increaseBlockInvalidCounter();
  await saveInvalidBlock({
    invalidCode: err.code,
    invalidMessage: err.message,
    ...block,
  });

  const transactions = await getTransactionByBlockNumberL2(block.blockNumberL2);

  const txDataToSign = await createChallenge(block, transactions, err);
  // push the challenge into the stop queue.  This will stop blocks being
  // made until the challenge has run and a rollback has happened.  We could
  // push anything into the queue and that would work but it's useful to
  // have the actual challenge to support syncing
  logger.debug('enqueuing event to stop queue');
  await enqueueEvent(commitToChallenge, 2, txDataToSign);
  await commitToChallenge(txDataToSign);
}

// Dispatch transactions to optimist for checking
async function dispatchTransactionsToOptimist(block, transactions) {
  // If exception is caught it means that transaction workers are not available. Lets verify
  //    transactions with optimist
  let transaction;
  let error = null;
  let incorrectTransaction = null;
  try {
    for (transaction of transactions) {
      // eslint-disable-next-line no-await-in-loop
      await checkTransaction({
        transaction,
        checkDuplicatesInL2: true,
        checkDuplicatesInMempool: true,
        transactionBlockNumberL2: block.blockNumberL2,
      });
    }
  } catch (err) {
    // Transaction check failed!!! Launch challenge
    error = err;
    incorrectTransaction = transaction;
  }
  return { error, incorrectTransaction };
}

// Check if the transactions are valid - transaction type, public input hash and proof
//   verification are all checked
//  If workers are enabled (not syncing), then dispatch to workers if available.
//   else,  optimist will do the checking
async function dispatchTransactions(block, transactions) {
  let error = null;
  let incorrectTransaction = null;
  if (workerEnableGet()) {
    try {
      const transactionStatus = (
        await Promise.all(
          transactions.map(transaction =>
            axios.post(`${txWorkerUrl}/check-transaction`, {
              transaction,
              checkDuplicatesInL2: true,
              checkDuplicatesInMempool: true,
              transactionBlockNumberL2: block.blockNumberL2,
            }),
          ),
        )
      ).map((status, transactionIndex) => {
        return { status: status.data.err, transactionIndex };
      });
      const transactionError = transactionStatus.filter(tx => typeof tx.status !== 'undefined');
      if (transactionError.length) {
        const { status, transactionIndex } = transactionError[0];
        error = status;
        incorrectTransaction = transactions[transactionIndex];
      }
    } catch (err) {
      // If exception is caught it means that transaction workers are not available. Lets verify
      //    transactions with optimist
      ({ error, incorrectTransaction } = await dispatchTransactionsToOptimist(block, transactions));
    }
  } else {
    ({ error, incorrectTransaction } = await dispatchTransactionsToOptimist(block, transactions));
  }
  return { error, incorrectTransaction };
}

/**
 * Checks the block's properties.  It will return the first inconsistency it finds
 * @param {object} block - the block being checked
 * @param {array} transactions - array of transaction objects whose transaction hashes are contained in the block (in hash order).
 */
// eslint-disable-next-line import/prefer-default-export
export async function checkBlock(block, transactions) {
  await Promise.all([
    checkLeafCount(block),
    checkBlockRoot(block),
    checkFrontier(block),
    checkDuplicateCommitmentsWithinBlock(block, transactions),
    checkDuplicateNullifiersWithinBlock(block, transactions),
  ]);

  // Check if my proposer build the received block. If so, we can skip transaction processing
  const proposers = (await getAllRegisteredProposers()).map(p => p._id.toLowerCase());
  if (proposers.includes(block.proposer)) {
    return;
  }

  const { error, incorrectTransaction } = await dispatchTransactions(block, transactions);

  if (error !== null) {
    const newError = await buildErrorMessage(error, block, transactions, incorrectTransaction);
    createAndCommitChallenge(newError, incorrectTransaction, block);
  }
}
