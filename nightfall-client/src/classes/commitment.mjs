/**
A commitment class
*/
import gen from 'general-number';
import config from 'config';
import poseidon from 'common-files/utils/crypto/poseidon/poseidon.mjs';
import { compressPublicKey } from '../services/keys.mjs';

const { generalise } = gen;
const { BN128_GROUP_ORDER } = config;

class Commitment {
  preimage;

  hash;

  isNullified = false;

  isNullifiedOnChain = -1;

  constructor({ ercAddress, tokenId, value, pkd, salt }) {
    const items = { ercAddress, tokenId, value, pkd, salt };
    const keys = Object.keys(items);
    for (const key of keys)
      if (items[key] === undefined)
        throw new Error(
          `Property ${key} was undefined. Did you pass the wrong object to the constructor?`,
        );

    // the compressedPkd is not part of the pre-image but it's used to look up
    // the commitment in the DB.
    this.preimage = generalise(items);
    this.compressedPkd = compressPublicKey(this.preimage.pkd);
    // we encode the top four bytes of the tokenId into the empty bytes at the top of the erc address.
    // this is consistent to what we do in the ZKP circuits
    const [top4Bytes, remainder] = this.preimage.tokenId.limbs(224, 2).map(l => BigInt(l));
    const SHIFT = 2923003274661805836407369665432566039311865085952n;
    this.hash = poseidon(
      generalise([
        this.preimage.ercAddress.bigInt + top4Bytes * SHIFT,
        remainder,
        this.preimage.value.field(BN128_GROUP_ORDER),
        this.preimage.pkd[0].field(BN128_GROUP_ORDER),
        this.preimage.pkd[1].field(BN128_GROUP_ORDER),
        this.preimage.salt.field(BN128_GROUP_ORDER),
      ]),
    );
  }

  // sometimes (e.g. going over http) the general-number class is inconvenient
  toHex() {
    return {
      preimage: this.preimage.all.hex(),
      hash: this.hash.hex(),
    };
  }
}

export default Commitment;
