/**
 * Module to handle new Transactions being posted
 */
import config from 'config';
import axios from 'axios';
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import constants from '@polygon-nightfall/common-files/constants/index.mjs';
import { waitForContract } from '@polygon-nightfall/common-files/utils/contract.mjs';
import {
  deleteDuplicateCommitmentsAndNullifiersFromMemPool,
  saveTransaction,
  saveBufferedTransaction,
} from '../services/database.mjs';
import { checkTransaction } from '../services/transaction-checker.mjs';
import TransactionError from '../classes/transaction-error.mjs';
import { getTransactionSubmittedCalldata } from '../services/process-calldata.mjs';

const { ZERO, STATE_CONTRACT_NAME } = constants;

const { txWorkerUrl, txWorkerCount } = config.TX_WORKER_PARAMS;

// Flag to enable/disable submitTransaction processing
let _submitTransactionEnable = true;
// Flag to enable/disable worker processing
let _workerEnable = true;

export function workerEnableSet(flag) {
  _workerEnable = flag;
}
export function workerEnableGet() {
  return _workerEnable;
}

export function submitTransactionEnable(enable) {
  _submitTransactionEnable = enable;
}

/**
 * Transaction Event Handler processing. It can be processed by main thread
 * or by worker thread
 *
 * @param {Object} _transaction Transaction data
 * @param {bolean} txEnable Flag indicating if transactions should be processed immediatelly (true)
 * or should be stored in a temporal buffer.
 */
export async function submitTransaction(transaction, txEnable) {
  logger.info({
    msg: 'Transaction Handler - New transaction received.',
    transaction,
    txEnable,
  });

  // Test mode. If txEnable is true, we process transactions as fast as we can (as usual). If false, then we
  // store these transactions in a buffer with the idea of processing them back later at once.
  if (!txEnable) {
    saveBufferedTransaction({ ...transaction });
    return;
  }
  const startTimeTx = new Date().getTime();

  try {
    const stateInstance = await waitForContract(STATE_CONTRACT_NAME);

    console.log(
      'Transaction State instance time RRRRRR',
      new Date().getTime() - startTimeTx,
      process.pid,
    );
    const startTimeTxInstance = new Date().getTime();
    const circuitInfo = await stateInstance.methods.getCircuitInfo(transaction.circuitHash).call();
    console.log(
      'Transaction State call circuit info time RRRRRR',
      new Date().getTime() - startTimeTxInstance,
      process.pid,
    );
    const startTimeTxScrow = new Date().getTime();
    if (circuitInfo.isEscrowRequired) {
      const isCommitmentEscrowed = await stateInstance.methods
        .getCommitmentEscrowed(transaction.commitments[0])
        .call();
      if (!isCommitmentEscrowed) {
        throw new TransactionError(
          `The commitment ${transaction.commitments[0]} has not been escrowed`,
        );
      }
      logger.info({ msg: `Commmitment ${transaction.commitments[0]} is escrowed` });
    }
    logger.info({ msg: 'Checking transaction validity...' });

    console.log(
      'Transaction Scrow time RRRRRR',
      new Date().getTime() - startTimeTxScrow,
      process.pid,
    );
    const startTimeTxCheckTx = new Date().getTime();

/*
    // OPTIMIZED
    const nonZeroCommitmentsAndNullifiers = await checkTransaction({
      transaction,
      checkDuplicatesInL2: true,
      checkDuplicatesInMempool: true,
    });
    const nonZeroCommitments = nonZeroCommitmentsAndNullifiers[0];
    const nonZeroNullifiers = nonZeroCommitmentsAndNullifiers[1];
    Promise.all([
      deleteDuplicateCommitmentsAndNullifiersFromMemPool(nonZeroCommitments, nonZeroNullifiers),
      saveTransaction({ ...transaction }),
    ]);
*/
    // DEFAULT
    await checkTransaction({
      transaction,
      checkDuplicatesInL2: true,
      checkDuplicatesInMempool: true,
    });

    const transactionCommitments = transaction.commitments.filter(c => c !== ZERO);
    const transactionNullifiers = transaction.nullifiers.filter(n => n !== ZERO);

    await deleteDuplicateCommitmentsAndNullifiersFromMemPool(
      transactionCommitments,
      transactionNullifiers,
    );

    await saveTransaction({ ...transaction });

    // END
    console.log(
      'Transaction check time RRRRRR',
      new Date().getTime() - startTimeTxCheckTx,
      process.pid,
    );

    console.log(
      'Transaction processing time RRRRRR',
      new Date().getTime() - startTimeTx,
      process.pid,
    );
  } catch (err) {
    if (err instanceof TransactionError) {
      logger.warn(
        `The transaction check failed with error: ${err.message}. The transaction has been ignored`,
      );
    } else {
      logger.error(err);
    }
  }
}

/**
 * This handler runs whenever a new transaction is submitted to the blockchain
 * Transaction Event Handler processing. It can be processed by main thread
 * or by worker thread
 * @param {Object} _transaction Transaction data
 * @param {boolean} fromBlockProposer Flag indicating whether this transaction comes from
 * block proposer (for those transactions that werent picked by current proposer).
 * @param {bolean} txEnable Flag indicating if transactions should be processed immediatelly (true)
 * or should be stored in a temporal buffer.
 */
export async function transactionSubmittedEventHandler(eventParams) {
  const { offchain = false, ...data } = eventParams;
  let transaction;
  if (offchain) {
    transaction = data;
    transaction.blockNumber = 'offchain';
    transaction.transactionHashL1 = 'offchain';
  } else {
    transaction = await getTransactionSubmittedCalldata(data);
    transaction.blockNumber = data.blockNumber;
    transaction.transactionHashL1 = data.transactionHash;
  }

  logger.info({
    msg: 'Transaction Handler - New transaction received.',
    transaction,
    txWorkerCount,
    _workerEnable,
  });

  // If TX WORKERS enabled or not responsive, route transaction requests to main thread
  if (Number(txWorkerCount) && _workerEnable) {
    axios
      .get(`${txWorkerUrl}/tx-submitted`, {
        params: {
          tx: transaction,
          enable: _submitTransactionEnable === true,
        },
      })
      .catch(function (error) {
        logger.error(`Error submit tx worker ${error}`);
        // Main thread (no workers)
        if (error.request) {
          submitTransaction(transaction, _submitTransactionEnable);
        }
      });
  } else {
    // Main thread (no workers)
    await submitTransaction(transaction, _submitTransactionEnable);
  }
}
