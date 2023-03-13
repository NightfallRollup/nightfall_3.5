/**
 * This module contains the logic needed create a zkp deposit, i.e. to pay
 * a token to the Shield contract and have it create a zkp commitment for the
 * same value. It is agnostic to whether we are dealing with an ERC20 or ERC721
 * (or ERC1155).
 * @module deposit.mjs
 * @author westlad, ChaitanyaKonda, iAmMichaelConnor, will-kim
 */
import config from 'config';
import gen from 'general-number';
import { randValueLT } from '@polygon-nightfall/common-files/utils/crypto/crypto-random.mjs';
import { waitForContract } from '@polygon-nightfall/common-files/utils/contract.mjs';
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import { compressProof } from '@polygon-nightfall/common-files/utils/curve-maths/curves.mjs';
import * as pm from '@polygon-nightfall/common-files/utils/stats.mjs';
import {
  getCircuitHash,
  generateProof,
} from '@polygon-nightfall/common-files/utils/worker-calls.mjs';
import constants from '@polygon-nightfall/common-files/constants/index.mjs';
import { Commitment, Transaction } from '../classes/index.mjs';
import { ZkpKeys } from './keys.mjs';
import { computeCircuitInputs } from '../utils/computeCircuitInputs.mjs';
import { getCommitmentInfo } from '../utils/getCommitmentInfo.mjs';
import { submitTransaction } from '../utils/submitTransaction.mjs';
import { getCommitmentByHash } from './commitment-storage.mjs';

const { VK_IDS } = config;
const { SHIELD_CONTRACT_NAME, BN128_GROUP_ORDER, DEPOSIT, DEPOSIT_FEE } = constants;
const { generalise } = gen;

async function deposit(depositParams) {
  pm.start('deposit');
  logger.info('Creating a deposit transaction');
  const { tokenType, providedCommitmentsFee, ...items } = depositParams;
  const ercAddress = generalise(items.ercAddress.toLowerCase());
  // before we do anything else, long hex strings should be generalised to make subsequent manipulations easier
  const {
    salt = (await randValueLT(BN128_GROUP_ORDER)).hex(),
    tokenId,
    value,
    fee,
    rootKey,
  } = generalise(items);
  const { compressedZkpPublicKey, nullifierKey } = new ZkpKeys(rootKey);
  const zkpPublicKey = ZkpKeys.decompressZkpPublicKey(compressedZkpPublicKey);

  // now we can compute a Witness so that we can generate the proof
  const shieldContractInstance = await waitForContract(SHIELD_CONTRACT_NAME);

  const feeL2TokenAddress = generalise(
    (await shieldContractInstance.methods.getFeeL2TokenAddress().call()).toLowerCase(),
  );

  let valueNewCommitment = value;

  let commitmentsInfo = {
    oldCommitments: [],
    nullifiers: [],
    newCommitments: [],
    localSiblingPaths: [],
    leafIndices: [],
    blockNumberL2s: [],
    roots: [],
    salts: [],
  };

  let circuitName = DEPOSIT_FEE;

  if (fee.bigInt > 0) {
    if (feeL2TokenAddress.hex(32) === ercAddress.hex(32)) {
      if (value.bigInt <= fee.bigInt) {
        throw new Error('Value deposited needs to be greater than the fee');
      }
      valueNewCommitment = generalise(value.bigInt - fee.bigInt);
      circuitName = DEPOSIT;
    } else {
      commitmentsInfo = await getCommitmentInfo({
        totalValueToSend: 0n,
        fee,
        ercAddress,
        feeL2TokenAddress,
        rootKey,
        maxNullifiers: VK_IDS[circuitName].numberNullifiers,
        maxNonFeeNullifiers: 0,
        providedCommitmentsFee,
      });
    }
  } else {
    circuitName = DEPOSIT;
  }

  let commitment = new Commitment({
    ercAddress,
    tokenId,
    value: valueNewCommitment,
    zkpPublicKey,
    salt,
  });

  // Mark the commitment as deposited
  commitment.isDeposited = true;

  // Prepend the new tokenised commitment
  commitmentsInfo.newCommitments = [commitment, ...commitmentsInfo.newCommitments];

  logger.debug({
    msg: 'Hash of new commitment',
    hash: commitment.hash.hex(),
  });

  const commitmentDB = await getCommitmentByHash(commitment);

  if (commitmentDB) {
    if (commitmentDB.isOnChain !== -1) {
      pm.stop('deposit');
      throw new Error('You can not re-send a commitment that is already on-chain');
    } else {
      commitment = commitmentDB;
    }
  }

  const circuitHash = await getCircuitHash(circuitName);

  const publicData = new Transaction({
    fee,
    historicRootBlockNumberL2: commitmentsInfo.blockNumberL2s,
    circuitHash,
    tokenType,
    tokenId,
    value,
    ercAddress,
    commitments: commitmentsInfo.newCommitments,
    nullifiers: commitmentsInfo.nullifiers,
    numberNullifiers: VK_IDS[circuitName].numberNullifiers,
    numberCommitments: VK_IDS[circuitName].numberCommitments,
    isOnlyL2: false,
  });

  const privateData = {
    rootKey,
    oldCommitmentPreimage: commitmentsInfo.oldCommitments.map(o => {
      return { value: o.preimage.value, salt: o.preimage.salt };
    }),
    paths: commitmentsInfo.localSiblingPaths.map(siblingPath => siblingPath.slice(1)),
    orders: commitmentsInfo.leafIndices,
    newCommitmentPreimage: commitmentsInfo.newCommitments.map(o => {
      return { value: o.preimage.value, salt: o.preimage.salt };
    }),
    recipientPublicKeys: commitmentsInfo.newCommitments.map(o => o.preimage.zkpPublicKey),
  };

  pm.start('deposit - computeCircuitInputs');
  const witness = computeCircuitInputs(
    publicData,
    privateData,
    commitmentsInfo.roots,
    feeL2TokenAddress,
    VK_IDS[circuitName].numberNullifiers,
    VK_IDS[circuitName].numberCommitments,
  );
  pm.stop('deposit - computeCircuitInputs');
  logger.debug({
    msg: 'witness input is',
    witness,
  });
  pm.start('deposit - generateProof');
  // call a worker to generate the proof
  const res = await generateProof({ folderpath: circuitName, witness });
  pm.stop('deposit - generateProof');

  logger.trace({
    msg: 'Received response from generate-proof',
    response: res.data,
  });

  const { proof } = res.data;
  // and work out the ABI encoded data that the caller should sign and send to the shield contract
  // first, get the contract instance

  // next we need to compute the optimistic Transaction object
  pm.start('deposit - compressProof');
  const transaction = { ...publicData, proof: compressProof(proof) };
  pm.stop('deposit - compressProof');
  pm.start('deposit - txCalcHash');
  transaction.transactionHash = Transaction.calcHash(transaction);
  pm.stop('deposit - txCalcHash');

  logger.debug({
    msg: `Client made ${circuitName}`,
    transaction,
  });

  pm.start('deposit - submitTransaction');
  // and then we can create an unsigned blockchain transaction
  try {
    // store the commitment on successful computation of the transaction
    const rawTransaction = await shieldContractInstance.methods
      .submitTransaction(Transaction.buildSolidityStruct(transaction))
      .encodeABI();
    await submitTransaction(
      transaction,
      commitmentsInfo,
      compressedZkpPublicKey,
      nullifierKey,
      false,
    );
    pm.stop('deposit - submitTransaction');
    pm.stop('deposit');
    return { rawTransaction, transaction };
  } catch (err) {
    pm.stop('deposit');
    logger.error(err);
    throw err; // let the caller handle the error
  }
}

export default deposit;
