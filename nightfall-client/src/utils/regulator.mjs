import { scalarMult } from '@polygon-nightfall/common-files/utils/curve-maths/curves.mjs';
import logger from '@polygon-nightfall/common-files/utils/logger.mjs';
import axios from 'axios';

/**
This function registers the sender-receiver to the regulator and gets the sharedPub for the sender to generate the secret.
@function registerPairSenderReceiv1er
@param {String} regulatorUrl - regulator Url for registering the pair sender receiver
@param {String} senderPublicKey - sender public key
@param {String} receiverPublicKey - receiver public key
@param {String} transferPublicKey - transfer public key
@param {String} transferPrivateKey - transfer private key
@returns {[String, String]} [sharedPubSender, sharedPubReceiver] - shared public secret for sender and receiver
*/
const registerPairSenderReceiverToRegulator = (
  regulatorUrl,
  senderPublicKey,
  receiverPublicKey,
  transferPublicKey,
  transferPrivateKey,
) => {
  const sharedPubRegulator = scalarMult(
    transferPrivateKey.bigInt,
    receiverPublicKey.map(r => r.bigInt),
  );

  logger.debug({
    msg: `Registering sender-receiver to regulator ${regulatorUrl}`,
    senderPublicKey,
    receiverPublicKey,
    transferPublicKey,
    sharedPubRegulator,
  });

  return axios.post(`${regulatorUrl}/regulator/registerPairSenderReceiver`, {
    senderPublicKey,
    receiverPublicKey,
    transferPublicKey,
    sharedPubRegulator,
  });
};

export default registerPairSenderReceiverToRegulator;
