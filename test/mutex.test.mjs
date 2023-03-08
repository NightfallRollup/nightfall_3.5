/* eslint import/no-extraneous-dependencies: "off" */

import chai from 'chai';
import ClusterMutex from '../utils/mutex.mjs';

const { expect } = chai;
let mutex;
const userIndex1 = 12345;
const userIndex2 = 54321;

describe('Mutex tests', function () {
  before(async () => {
    mutex = new ClusterMutex(1000);
  });
  it('Lock mutex - check is locked and unlocked after timeout', async () => {
    const lockReceipt = await mutex.lock(userIndex1);
    expect(mutex.isLocked(userIndex1, lockReceipt)).to.be.equal(true);

    await new Promise(resolve => setTimeout(() => resolve(), 3000));
    expect(mutex.isLocked(userIndex1, lockReceipt)).to.be.equal(false);
  });

  it('Lock mutex - check mutex can be locked after timeout', async () => {
    const lockReceipt = await mutex.lock(userIndex1);
    expect(mutex.isLocked(userIndex1, lockReceipt)).to.be.equal(true);

    await new Promise(resolve => setTimeout(() => resolve(), 3000));
    expect(mutex.isLocked(userIndex1, lockReceipt)).to.be.equal(false);
  });

  it('Lock mutex - check mutex is free if not aquired', async () => {
    expect(mutex.isLocked(userIndex1, 0)).to.be.equal(false);
  });

  it('Lock mutex - check mutex is free if incorrect reserve', async () => {
    await mutex.lock(userIndex1);
    expect(mutex.isLocked(userIndex1, 0)).to.be.equal(false);
    await new Promise(resolve => setTimeout(() => resolve(), 3000));
  });

  it('Lock mutex - check mutex is free if incorrect user', async () => {
    const lockReceipt = await mutex.lock(userIndex1);
    expect(mutex.isLocked(userIndex2, lockReceipt)).to.be.equal(false);
    await new Promise(resolve => setTimeout(() => resolve(), 3000));
  });

  it('Lock mutex - check mutex is locked before it expires', async () => {
    const lockReceipt = await mutex.lock(userIndex1);
    await new Promise(resolve => setTimeout(() => resolve(), 100));
    expect(mutex.isLocked(userIndex1, lockReceipt)).to.be.equal(true);
  });

  it('Lock mutex - check lock 2 mutex', async () => {
    const lockReceipt1 = await mutex.lock(userIndex1);
    const lockReceipt2 = await mutex.lock(userIndex2);
    await new Promise(resolve => setTimeout(() => resolve(), 100));
    expect(mutex.isLocked(userIndex1, lockReceipt1)).to.be.equal(true);
    expect(mutex.isLocked(userIndex2, lockReceipt2)).to.be.equal(true);
    await new Promise(resolve => setTimeout(() => resolve(), 3000));
    expect(mutex.isLocked(userIndex1, lockReceipt1)).to.be.equal(false);
    expect(mutex.isLocked(userIndex2, lockReceipt2)).to.be.equal(false);
  });

  it('Lock mutex - check mutex can be locked after timeout', async () => {
    const time1 = new Date().getTime();
    const lockReceipt1 = await mutex.lock(userIndex1);
    const lockReceipt2 = await mutex.lock(userIndex1);
    const time2 = new Date().getTime();
    expect(time2 - time1).to.be.greaterThan(mutex.expiration());
    expect(mutex.isLocked(userIndex1, lockReceipt1)).to.be.equal(false);
    expect(mutex.isLocked(userIndex1, lockReceipt2)).to.be.equal(true);
    await new Promise(resolve => setTimeout(() => resolve(), 3000));
    expect(mutex.isLocked(userIndex1, lockReceipt2)).to.be.equal(false);
  });

  it('Release mutex - check mutex is correctly released', async () => {
    const lockReceipt = await mutex.lock(userIndex1);
    await new Promise(resolve => setTimeout(() => resolve(), 100));
    expect(mutex.release(userIndex1, lockReceipt)).to.be.equal(true);
    expect(mutex.isLocked(userIndex1, lockReceipt)).to.be.equal(false);
  });

  it('Release mutex - check mutex cannot be released twice', async () => {
    const lockReceipt = await mutex.lock(userIndex1);
    await new Promise(resolve => setTimeout(() => resolve(), 100));
    expect(mutex.release(userIndex1, lockReceipt)).to.be.equal(true);
    expect(mutex.release(userIndex1, lockReceipt)).to.be.equal(false);
  });

  it('Release mutex - check mutex cannot be released after timeout', async () => {
    const lockReceipt = await mutex.lock(userIndex1);
    await new Promise(resolve => setTimeout(() => resolve(), 3000));
    expect(mutex.release(userIndex1, lockReceipt)).to.be.equal(false);
  });

  it('Release mutex - check mutex cannot be released with incorrect receipt', async () => {
    await mutex.lock(userIndex1);
    await new Promise(resolve => setTimeout(() => resolve(), 100));
    expect(mutex.release(userIndex1, 0)).to.be.equal(false);
    await new Promise(resolve => setTimeout(() => resolve(), 3000));
  });

  it('Release mutex - check mutex cannot be released with incorrect user', async () => {
    const lockReceipt = await mutex.lock(userIndex1);
    await new Promise(resolve => setTimeout(() => resolve(), 100));
    expect(mutex.release(userIndex2, lockReceipt)).to.be.equal(false);
    await new Promise(resolve => setTimeout(() => resolve(), 3000));
  });
  it('Release mutex - check release 2 mutex', async () => {
    const lockReceipt1 = await mutex.lock(userIndex1);
    const lockReceipt2 = await mutex.lock(userIndex2);
    await new Promise(resolve => setTimeout(() => resolve(), 100));
    expect(mutex.release(userIndex1, lockReceipt1)).to.be.equal(true);
    expect(mutex.release(userIndex2, lockReceipt2)).to.be.equal(true);
    expect(mutex.isLocked(userIndex1, lockReceipt1)).to.be.equal(false);
    expect(mutex.isLocked(userIndex2, lockReceipt2)).to.be.equal(false);
    await new Promise(resolve => setTimeout(() => resolve(), 3000));
  });
});
