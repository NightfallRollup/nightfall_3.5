/* eslint-disable camelcase */
/*
    Copyright 2018 0kims association.
    This file is part of snarkjs.
    snarkjs is a free software: you can redistribute it and/or
    modify it under the terms of the GNU General Public License as published by the
    Free Software Foundation, either version 3 of the License, or (at your option)
    any later version.
    snarkjs is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
    more details.
    You should have received a copy of the GNU General Public License along with
    snarkjs. If not, see <https://www.gnu.org/licenses/>.
*/

/* Implementation of this paper: https://eprint.iacr.org/2016/260.pdf */
import { Scalar, utils } from 'ffjavascript';
import * as curves from './curves.mjs';

const { unstringifyBigInts } = utils;
let _curve = null;
const _vk_gamma_2 = {};
const _vk_delta_2 = {};
const _vk_alpha_1 = {};
const _vk_beta_2 = {};
const _IC0 = {};
const _vkVerifier = {};
const _IC = {};
const _w = {};

function getVks(circuitHash, vk_verifier) {
  if (!(circuitHash in _vk_gamma_2))
    _vk_gamma_2[circuitHash] = _curve.G2.fromObject(vk_verifier.vk_gamma_2);
  if (!(circuitHash in _vk_delta_2))
    _vk_delta_2[circuitHash] = _curve.G2.fromObject(vk_verifier.vk_delta_2);
  if (!(circuitHash in _vk_alpha_1))
    _vk_alpha_1[circuitHash] = _curve.G1.fromObject(vk_verifier.vk_alpha_1);
  if (!(circuitHash in _vk_beta_2))
    _vk_beta_2[circuitHash] = _curve.G2.fromObject(vk_verifier.vk_beta_2);

  return [
    _vk_gamma_2[circuitHash],
    _vk_delta_2[circuitHash],
    _vk_alpha_1[circuitHash],
    _vk_beta_2[circuitHash],
  ];
}

function getIC0(circuitHash, vk_verifier) {
  if (!(circuitHash in _IC0)) _IC0[circuitHash] = _curve.G1.fromObject(vk_verifier.IC[0]);
  return _IC0[circuitHash];
}

function getVkVerifier(circuitHash, _vk_verifier) {
  if (!(circuitHash in _vkVerifier)) _vkVerifier[circuitHash] = unstringifyBigInts(_vk_verifier);
  return _vkVerifier[circuitHash];
}

function getIC(circuitHash, pSigLen) {
  if (!(circuitHash in _IC)) _IC[circuitHash] = new Uint8Array(_curve.G1.F.n8 * 2 * pSigLen);
  return _IC[circuitHash];
}
function getW(circuitHash, pSigLen) {
  if (!(circuitHash in _w)) _w[circuitHash] = new Uint8Array(_curve.Fr.n8 * pSigLen);
  return _w[circuitHash];
}

export default async function groth16Verify(
  _vk_verifier,
  _publicSignals,
  _proof,
  circuitHash,
  logger,
) {
  /*
    let cpub = vk_verifier.IC[0];
    for (let s= 0; s< vk_verifier.nPublic; s++) {
        cpub  = G1.add( cpub, G1.timesScalar( vk_verifier.IC[s+1], publicSignals[s]));
    }
*/

  const vk_verifier = getVkVerifier(circuitHash, _vk_verifier);
  const proof = unstringifyBigInts(_proof);
  const publicSignals = unstringifyBigInts(_publicSignals);

  // cache curve
  if (_curve === null) _curve = await curves.getCurveFromName(vk_verifier.curve);

  // cache vks
  const [vk_gamma_2, vk_delta_2, vk_alpha_1, vk_beta_2] = getVks(circuitHash, vk_verifier);

  const IC0 = getIC0(circuitHash, vk_verifier);

  const IC = getIC(circuitHash, publicSignals.length);
  const w = getW(circuitHash, publicSignals.length);

  for (let i = 0; i < publicSignals.length; i++) {
    const buffP = _curve.G1.fromObject(vk_verifier.IC[i + 1]);
    IC.set(buffP, i * _curve.G1.F.n8 * 2);
    Scalar.toRprLE(w, _curve.Fr.n8 * i, publicSignals[i], _curve.Fr.n8);
  }

  let cpub = await _curve.G1.multiExpAffine(IC, w);
  cpub = _curve.G1.add(cpub, IC0);

  const pi_a = _curve.G1.fromObject(proof.pi_a);
  const pi_b = _curve.G2.fromObject(proof.pi_b);
  const pi_c = _curve.G1.fromObject(proof.pi_c);

  const res = await _curve.pairingEq(
    _curve.G1.neg(pi_a),
    pi_b,
    cpub,
    vk_gamma_2,
    pi_c,
    vk_delta_2,

    vk_alpha_1,
    vk_beta_2,
  );

  if (!res) {
    if (logger) logger.error('Invalid proof');
    return false;
  }

  if (logger) logger.info('OK!');
  return true;
}
