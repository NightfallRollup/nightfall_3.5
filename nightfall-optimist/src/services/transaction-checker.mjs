/* eslint-disable no-await-in-loop */
/**
Module to check that a transaction is valid
Here are the things that could be wrong with a transaction:
- the proof doesn't verify
- transaction has a duplicate commitment
- transaction has a duplicate nullifier
*/

import config from 'config';
import gen from 'general-number';
import constants from '@polygon-nightfall/common-files/constants/index.mjs';
import { waitForContract } from '@polygon-nightfall/common-files/utils/contract.mjs';
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import * as snarkjs from 'snarkjs';
import groth16Verify from './groth16_verify.mjs';
import { decompressProof } from '@polygon-nightfall/common-files/utils/curve-maths/curves.mjs';
import { VerificationKey, Proof, TransactionError } from '../classes/index.mjs';
import {
  getBlockByBlockNumberL2,
  getTransactionHashSiblingInfo,
  getMempoolTransactionByCommitment,
  getMempoolTransactionByNullifier,
  getTransactionL2ByCommitment,
  getTransactionL2ByNullifier,
  getTransactionByNullifier,
  getTransactionByCommitment,
} from './database.mjs';

const { generalise } = gen;
const { PROVING_SCHEME, CURVE } = config;
const { ZERO, STATE_CONTRACT_NAME, SHIELD_CONTRACT_NAME } = constants;
const CACHE_VERIFICATION_KEY = new Map();
const CACHE_FEE_L2_TOKEN_ADDRESS = new Map();

let lastProcessedBlockNumberL2 = -1;

export function setLastProcessedBlockNumberL2(lastBlockNumberL2) {
  lastProcessedBlockNumberL2 = lastBlockNumberL2;
}

/*
async function checkDuplicateCommitment({
  transaction,
  checkDuplicatesInL2,
  checkDuplicatesInMempool,
  transactionBlockNumberL2,
}) {
  // Note: There is no need to check the duplicate commitment in the same transaction since this is already checked in the circuit
  // check if any commitment in the transaction is already part of an L2 block

  // Check if any transaction has a duplicated commitment
  const timeStart = new Date().getTime();
  const nonzeroCommitments = []
  for (const [index, commitment] of transaction.commitments.entries()) {
    if (commitment !== ZERO) {
      nonzeroCommitments.push(commitment)
      if (checkDuplicatesInMempool) {
        const transactionMempoolHigherFee = await getMempoolTransactionByCommitment(
          commitment,
          transaction.fee,
        );

        if (transactionMempoolHigherFee !== null) {
          logger.debug({
            msg: 'Duplicate mempool commitment with higher fee: ',
            transactionMempoolHigherFee,
          });
          throw new TransactionError(
            `The transaction has a duplicate commitment ${commitment} in the mempool with a higher fee`,
            0,
            undefined,
          );
        }
      }

      if (checkDuplicatesInL2) {
        // Search if there is any transaction in L2 that already contains the commitment
        const transactionL2 = await getTransactionL2ByCommitment(
          commitment,
          transactionBlockNumberL2,
        );
        // If a transaction was found, means that the commitment is duplicated
        if (transactionL2 !== null) {
          // Get the number of the block in L2 containing the duplicated commitment
          const blockL2 = await getBlockByBlockNumberL2(transactionL2.blockNumberL2);

          if (blockL2 !== null) {
            const siblingPath2 = (
              await getTransactionHashSiblingInfo(transactionL2.transactionHash)
            ).transactionHashSiblingPath;
            throw new TransactionError(
              `The transaction has a duplicate commitment ${commitment} in a previous L2 block`,
              0,
              {
                duplicateCommitment1Index: index,
                block2: blockL2,
                transaction2: transactionL2,
                transaction2Index: blockL2.transactionHashes.indexOf(transactionL2.transactionHash),
                siblingPath2,
                duplicateCommitment2Index: transactionL2.commitments.indexOf(commitment),
              },
            );
          }
        }
      }
    }
  }
  console.log('checkDupliocateCommitment Time RRRRR', new Date().getTime() - timeStart);
  return nonzeroCommitments;
}
*/

async function checkDuplicateCommitment({
  transaction,
  checkDuplicatesInL2,
  checkDuplicatesInMempool,
  transactionBlockNumberL2,
}) {
  // Note: There is no need to check the duplicate commitment in the same transaction since this is already checked in the circuit
  // check if any commitment in the transaction is already part of an L2 block

  const timeStart = new Date().getTime();
  // Check if any transaction has a duplicated commitment
  const filteredTransactions = await getTransactionByCommitment(
    transaction.commitments.filter(c => c !== ZERO),
  );
  if (checkDuplicatesInMempool) {
    const transactionMempoolHigherFee = filteredTransactions.filter(
      tx => tx.mempool && tx.fee > transaction.fee,
    );

    if (transactionMempoolHigherFee.length) {
      logger.debug({
        msg: 'Duplicate mempool commitment with higher fee: ',
        transactionMempoolHigherFee,
        fee: transaction.fee,
      });
      throw new TransactionError(
        `The transaction has a duplicate commitment in the mempool with a higher fee`,
        0,
        undefined,
      );
    }
  }
  if (checkDuplicatesInL2) {
    const transactionL2 = filteredTransactions.filter(
      tx => tx.blockNumberL2 > -1 && tx.blockNumberL2 !== transactionBlockNumberL2,
    );
  }

  console.log('checkDupliocateCommitment Time RRRRR', new Date().getTime() - timeStart);
  return filteredTransactions;
}

/*
async function checkDuplicateNullifier({
  transaction,
  checkDuplicatesInL2,
  checkDuplicatesInMempool,
  transactionBlockNumberL2,
}) {
  // Note: There is no need to check the duplicate nullifiers in the same transaction since this is already checked in the circuit
  // check if any nullifier in the transction is already part of an L2 block
  const startTime = new Date().getTime();
  const nonzeroNullifiers = []
  for (const [index, nullifier] of transaction.nullifiers.entries()) {
    if (nullifier !== ZERO) {
      nonzeroNullifiers.push(nullifier);
      if (checkDuplicatesInMempool) {
        const transactionMempoolHigherFee = await getMempoolTransactionByNullifier(
          nullifier,
          transaction.fee,
        );

        if (transactionMempoolHigherFee !== null) {
          logger.debug({
            msg: 'Duplicate mempool nullifier with higher fee: ',
            transactionMempoolHigherFee,
          });
          throw new TransactionError(
            `The transaction has a duplicate commitment ${nullifier} in the mempool with a higher fee`,
            1,
            undefined,
          );
        }
      }

      if (checkDuplicatesInL2) {
        // Search if there is any transaction in L2 that already contains the commitment
        const transactionL2 = await getTransactionL2ByNullifier(
          nullifier,
          transactionBlockNumberL2,
        );
        // If a transaction was found, means that the commitment is duplicated
        if (transactionL2 !== null) {
          // Get the number of the block in L2 containing the duplicated commitment
          const blockL2 = await getBlockByBlockNumberL2(transactionL2.blockNumberL2);

          if (blockL2 !== null) {
            const siblingPath2 = (
              await getTransactionHashSiblingInfo(transactionL2.transactionHash)
            ).transactionHashSiblingPath;
            throw new TransactionError(
              `The transaction has a duplicate nullifier ${nullifier} in a previous L2 block`,
              1,
              {
                duplicateNullifier1Index: index,
                block2: blockL2,
                transaction2: transactionL2,
                transaction2Index: blockL2.transactionHashes.indexOf(transactionL2.transactionHash),
                siblingPath2,
                duplicateNullifier2Index: transactionL2.nullifiers.indexOf(nullifier),
              },
            );
          }
        }
      }
    }
  }
  console.log('checkDupliocateNullifier Time RRRRR', new Date().getTime() - startTime);
  return nonzeroNullifiers;
}
*/

async function checkDuplicateNullifier({
  transaction,
  checkDuplicatesInL2,
  checkDuplicatesInMempool,
  transactionBlockNumberL2,
}) {
  const startTime = new Date().getTime();
  // Note: There is no need to check the duplicate nullifiers in the same transaction since this is already checked in the circuit
  // check if any nullifier in the transction is already part of an L2 block
  const filteredTransactions = await getTransactionByNullifier(
    transaction.nullifiers.filter(n => n !== ZERO),
  );
  if (checkDuplicatesInMempool) {
    const transactionMempoolHigherFee = filteredTransactions.filter(
      tx => tx.mempool && tx.fee > transaction.fee,
    );

    if (transactionMempoolHigherFee.length) {
      logger.debug({
        msg: 'Duplicate mempool nullifier with higher fee: ',
        transactionMempoolHigherFee,
        fee: transaction.fee,
      });
      throw new TransactionError(
        `The transaction has a duplicate nullifier in the mempool with a higher fee`,
        0,
        undefined,
      );
    }
  }
  if (checkDuplicatesInL2) {
    const transactionL2 = filteredTransactions.filter(
      tx => tx.blockNumberL2 > -1 && tx.blockNumberL2 !== transactionBlockNumberL2,
    );
  }
  console.log('checkDupliocateNullifier Time RRRRR', new Date().getTime() - startTime);
  return filteredTransactions;

}

async function checkHistoricRootBlockNumber(
  transaction,
  lastValidBlockNumberL2,
  stateConractInstance,
) {
  const startTime = new Date().getTime();
  let latestBlockNumberL2;
  if (lastValidBlockNumberL2) {
    latestBlockNumberL2 = lastValidBlockNumberL2;
  } else {
    // TODO: getting lastestBlock from contract seems not necessary as we only check that transaction
    //  block number is less or equal to real l2 block. So, we can keep a local copy of latest block
    // received.

    // latestBlockNumberL2 = Number(
    // (await stateConractInstance.methods.getNumberOfL2Blocks().call()) - 1,
    // );
    latestBlockNumberL2 = lastProcessedBlockNumberL2;
  }

  logger.debug({ msg: `Latest valid block number in L2`, latestBlockNumberL2 });

  transaction.historicRootBlockNumberL2.forEach((blockNumberL2, i) => {
    if (transaction.nullifiers[i] === ZERO) {
      if (Number(blockNumberL2) !== 0) {
        throw new TransactionError('Invalid historic root', 3, {
          transactionHash: transaction.transactionHash,
        });
      }
    } else if (Number(blockNumberL2) > latestBlockNumberL2) {
      throw new TransactionError(
        `Historic root block number, which is ${Number(
          blockNumberL2,
        )}, has block number L2 greater than on chain, which is ${latestBlockNumberL2}`,
        3,
        {
          transactionHash: transaction.transactionHash,
        },
      );
    }
  });
  console.log('checkRoot Time RRRRR', new Date().getTime() - startTime);
}


async function verifyProof(transaction, stateConractInstance, shieldContractInstance) {
  const startTime = new Date().getTime();
  const vkArrayCached = CACHE_VERIFICATION_KEY.get(transaction.circuitHash);
  const vkArray =
    vkArrayCached ??
    (await stateConractInstance.methods.getVerificationKey(transaction.circuitHash).call());
  if (!vkArrayCached) {
    CACHE_VERIFICATION_KEY.set(transaction.circuitHash, vkArray);
  }

  if (vkArray.length < 33) throw new TransactionError('The verification key is incorrect', 2);

  const historicRoots = await Promise.all(
    Array.from({ length: transaction.nullifiers.length }, () => 0).map((value, index) => {
      if (transaction.nullifiers[index] === ZERO) return { root: ZERO };
      return (
        getBlockByBlockNumberL2(transaction.historicRootBlockNumberL2[index]) ?? { root: ZERO }
      );
    }),
  );

  logger.info({
    msg: 'Constructing proof with blockNumberL2s and roots',
    transaction: transaction.transactionHash,
    blockNumberL2s: transaction.historicRootBlockNumberL2.map(r => Number(r)),
    roots: historicRoots.map(h => h.root),
  });

  const feeL2TokenAddressCached = CACHE_FEE_L2_TOKEN_ADDRESS.get(transaction.circuitHash);
  const feeL2TokenAddress =
    feeL2TokenAddressCached ??
    (await shieldContractInstance.methods.getFeeL2TokenAddress().call()).toLowerCase();
  if (!feeL2TokenAddressCached) {
    CACHE_FEE_L2_TOKEN_ADDRESS.set(transaction.circuitHash, feeL2TokenAddress);
  }

  const inputs = generalise(
    [
      transaction.value,
      transaction.fee,
      transaction.circuitHash,
      transaction.tokenType,
      transaction.historicRootBlockNumberL2,
      transaction.ercAddress,
      generalise(transaction.tokenId).limbs(32, 8),
      transaction.recipientAddress,
      transaction.commitments,
      transaction.nullifiers,
      transaction.compressedSecrets,
      historicRoots.map(h => h.root),
      feeL2TokenAddress,
    ].flat(Infinity),
  ).all.bigInt.map(inp => inp.toString());

  const vk = new VerificationKey(vkArray, CURVE, PROVING_SCHEME, inputs.length);

  try {
    const uncompressedProof = decompressProof(transaction.proof);
    const proof = new Proof(uncompressedProof, CURVE, PROVING_SCHEME, inputs);

    const startTimeVerify = new Date().getTime();
    //console.log("CCCCCCCCCCCCCCCCCC", vk, inputs, proof)
    //const verifies = await snarkjs.groth16.verify(vk, inputs, proof);
    const verifies = await groth16Verify(vk, inputs, proof, transaction.circuitHash);
    console.log('verifyProof get verify RRRRRR', new Date().getTime() - startTimeVerify);

    console.log('verifyProof get verify Total RRRRRR', new Date().getTime() - startTime);
    if (!verifies) throw new TransactionError('The proof did not verify', 2);
  } catch (e) {
    if (e instanceof TransactionError) {
      throw e;
    } else {
      // Decompressing the Proof failed
      throw new TransactionError('Decompression failed', 2);
    }
  }
}

// eslint-disable-next-line import/prefer-default-export
export async function checkTransaction({
  transaction,
  checkDuplicatesInL2 = false,
  checkDuplicatesInMempool = false,
  transactionBlockNumberL2,
  lastValidBlockNumberL2,
}) {
  const startTimeReadContract = new Date().getTime();
  const [stateConractInstance, shieldContractInstance] = await Promise.all([
    waitForContract(STATE_CONTRACT_NAME),
    waitForContract(SHIELD_CONTRACT_NAME),
  ]);

  logger.info({ msg: 'Check Transaction', transaction });
  console.log(
    'Check Transaction contract time RRRRRR',
    new Date().getTime() - startTimeReadContract,
  );
  const startTimeDups = new Date().getTime();
  await Promise.all([
    checkDuplicateCommitment({
      transaction,
      checkDuplicatesInL2,
      checkDuplicatesInMempool,
      transactionBlockNumberL2,
    }),
    checkDuplicateNullifier({
      transaction,
      checkDuplicatesInL2,
      checkDuplicatesInMempool,
      transactionBlockNumberL2,
    }),
    checkHistoricRootBlockNumber(transaction, lastValidBlockNumberL2, stateConractInstance),
  ]);
  console.log('Check Transaction Dups RRRRRR', new Date().getTime() - startTimeDups);
  await verifyProof(transaction, stateConractInstance, shieldContractInstance);
}
