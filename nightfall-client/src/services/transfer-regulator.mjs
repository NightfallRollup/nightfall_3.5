/**
 * This module contains the logic needed create a zkp transfer for regulator
 * It is agnostic to whether we are dealing with an ERC20 or ERC721 (or ERC1155).
 * @module transfer-regulator.mjs
 * @author daveroga
 */
import config from 'config';
import gen from 'general-number';
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import {
  edwardsCompress,
  compressProof,
} from '@polygon-nightfall/common-files/utils/curve-maths/curves.mjs';
import constants from '@polygon-nightfall/common-files/constants/index.mjs';
import { waitForContract } from '@polygon-nightfall/common-files/utils/contract.mjs';
import {
  getCircuitHash,
  generateProof,
} from '@polygon-nightfall/common-files/utils/worker-calls.mjs';
import { Transaction } from '../classes/index.mjs';
import { ZkpKeys } from './keys.mjs';
import { computeCircuitInputs } from '../utils/computeCircuitInputs.mjs';
import { encrypt, genTransferKeysForObservers, packSecrets, randomNonce } from './kem-dem.mjs';
import registerPairSenderReceiverToRegulator from '../utils/regulator.mjs';
import { clearPending } from './commitment-storage.mjs';
import { getCommitmentInfo } from '../utils/getCommitmentInfo.mjs';
import { submitTransaction } from '../utils/submitTransaction.mjs';

const { VK_IDS, REGULATOR_URL, NONCE_ENCRYPTION_BITS } = config;
const { SHIELD_CONTRACT_NAME, TRANSFER_REGULATOR } = constants;
const { generalise } = gen;

async function transferRegulator(transferParams) {
  logger.info('Creating a transfer transaction');
  // let's extract the input items
  const {
    offchain = false,
    providedCommitments,
    providedCommitmentsFee,
    ...items
  } = transferParams;
  const { tokenId, recipientData, rootKey, fee } = generalise(items);
  const { compressedZkpPublicKey, nullifierKey, zkpPrivateKey, zkpPublicKey } = new ZkpKeys(
    rootKey,
  );
  const ercAddress = generalise(items.ercAddress.toLowerCase());
  const { recipientCompressedZkpPublicKeys, values } = recipientData;
  const recipientZkpPublicKeys = recipientCompressedZkpPublicKeys.map(key =>
    ZkpKeys.decompressZkpPublicKey(key),
  );
  if (recipientCompressedZkpPublicKeys.length > 1)
    throw new Error(`Batching is not supported yet: only one recipient is allowed`); // this will not always be true so we try to make the following code agnostic to the number of commitments

  const shieldContractInstance = await waitForContract(SHIELD_CONTRACT_NAME);

  const feeL2TokenAddress = generalise(
    (await shieldContractInstance.methods.getFeeL2TokenAddress().call()).toLowerCase(),
  );

  logger.debug({
    msg: 'Transfer with regulator ERC Token & Fee addresses',
    ercAddress: ercAddress.hex(32),
    feeL2TokenAddress: feeL2TokenAddress.hex(32),
  });

  const circuitName = TRANSFER_REGULATOR;

  const totalValueToSend = values.reduce((acc, value) => acc + value.bigInt, 0n);
  const commitmentsInfo = await getCommitmentInfo({
    totalValueToSend,
    fee,
    recipientZkpPublicKeysArray: recipientZkpPublicKeys,
    ercAddress,
    feeL2TokenAddress,
    tokenId,
    rootKey,
    maxNullifiers: VK_IDS[circuitName].numberNullifiers,
    providedCommitments,
    providedCommitmentsFee,
  });

  try {
    // KEM-DEM encryption with 3 peers
    const [observerEphPrivate, observerEphPublic] = await genTransferKeysForObservers(
      generalise(zkpPrivateKey),
      generalise(recipientZkpPublicKeys[0]),
    );

    const [sharedPubSender, sharedPubReceiver] = registerPairSenderReceiverToRegulator(
      REGULATOR_URL,
      generalise(zkpPublicKey),
      generalise(recipientZkpPublicKeys[0]),
      generalise(observerEphPublic),
      generalise(observerEphPrivate),
    );

    const [unpackedTokenID, packedErc] = packSecrets(tokenId, ercAddress, 0, 2);
    const nonce = randomNonce(1, 2 ** NONCE_ENCRYPTION_BITS - 1); // generate a 6 bytes random nonce

    const compressedSecrets = encrypt(
      generalise(observerEphPrivate),
      generalise(sharedPubSender),
      [packedErc.bigInt, unpackedTokenID.bigInt, values[0].bigInt, commitmentsInfo.salts[0].bigInt],
      nonce,
    );

    // Compress the public key as it will be put on-chain for the receiver
    const compressedEPub = edwardsCompress(sharedPubReceiver);
    const circuitHash = await getCircuitHash(circuitName);

    // now we have everything we need to create a Witness and compute a proof
    const publicData = new Transaction({
      fee,
      historicRootBlockNumberL2: commitmentsInfo.blockNumberL2s,
      circuitHash,
      ercAddress: compressedSecrets[0], // this is the encrypted ercAddress
      tokenId: compressedEPub,
      recipientAddress: compressedSecrets[1], // this is the encrypted tokenID
      commitments: commitmentsInfo.newCommitments,
      nullifiers: commitmentsInfo.nullifiers,
      compressedSecrets: compressedSecrets.slice(2), // these are the [value, salt]
      numberNullifiers: VK_IDS[circuitName].numberNullifiers,
      numberCommitments: VK_IDS[circuitName].numberCommitments,
      isOnlyL2: true,
      value: nonce,
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
      ercAddress,
      tokenId,
      ephemeralKey: observerEphPrivate,
      sharedPubSender,
    };

    const witness = computeCircuitInputs(
      publicData,
      privateData,
      commitmentsInfo.roots,
      feeL2TokenAddress,
      VK_IDS[circuitName].numberNullifiers,
      VK_IDS[circuitName].numberCommitments,
    );

    logger.debug({
      msg: 'witness input is',
      witness,
    });

    // call a worker to generate the proof
    const res = await generateProof({ folderpath: circuitName, witness });

    logger.trace({
      msg: 'Received response from generate-proof',
      response: res.data,
    });

    const { proof } = res.data;
    // and work out the ABI encoded data that the caller should sign and send to the shield contract
    const transaction = { ...publicData, proof: compressProof(proof) };
    transaction.transactionHash = Transaction.calcHash(transaction);

    logger.debug({
      msg: `Client made ${circuitName}`,
      transaction,
      offchain,
    });

    const rawTransaction = await shieldContractInstance.methods
      .submitTransaction(Transaction.buildSolidityStruct(transaction))
      .encodeABI();
    await submitTransaction(
      transaction,
      commitmentsInfo,
      compressedZkpPublicKey,
      nullifierKey,
      offchain,
    );

    return { rawTransaction, transaction };
  } catch (error) {
    await Promise.all(commitmentsInfo.oldCommitments.map(o => clearPending(o)));
    logger.error(error);
    throw error;
  }
}

export default transferRegulator;