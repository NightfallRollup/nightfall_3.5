/* eslint-disable import/prefer-default-export */
/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */

// ignore unused exports
export async function getCommitmentsAvailableByHashFaulty(hashes, compressedZkpPublicKey) {
  const connection = await mongo.connection(MONGO_URL);
  const db = connection.db(COMMITMENTS_DB);
  const query = {
    _id: { $in: hashes },
    compressedZkpPublicKey: compressedZkpPublicKey.hex(32),
  };
  return db.collection(COMMITMENTS_COLLECTION).find(query).toArray();
}

async function getAvailableCommitmentsFaulty(db, compressedZkpPublicKey, ercAddress, tokenId) {
  return db
    .collection(COMMITMENTS_COLLECTION)
    .find({
      compressedZkpPublicKey: compressedZkpPublicKey.hex(32),
      'preimage.ercAddress': ercAddress.hex(32),
      'preimage.tokenId': tokenId.hex(32),
      isNullifiedOnChain: { $ne: -1 },
    })
    .toArray();
}
