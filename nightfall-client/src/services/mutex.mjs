import { Mutex } from 'async-mutex';

/**
 * ClusterMutex defines a mutex implementation that can be used to protect shared resources used by different
 * procesess of nodejs. Additionaly, resources only need to be protected when used by the same user.
 *
 * To accomplish this, lock requires a user number so that the correct mutex is acquired. Internally, number of
 * users are reduced to MAX_N_MUTEX to prevent excessive number. When a mutex is locked, a timeout is started
 * to prevent infinite lock.
 *
 */

// Maximum number of mutexes that can be created
const MAX_N_MUTEX = 1024;
// Maximum time in ms lock can be acquired. After this time, lock will be released.
const MAX_TIMEOUT = 1000;
// Maximum reservation number
const MAX_RESERVE = 4294967296;

class ClusterMutex {
  mutexData;

  timeout;

  constructor(maxTimeout = MAX_TIMEOUT) {
    this.mutexData = [];
    for (let i = 0; i < MAX_N_MUTEX; i++) {
      this.mutexData.push({ mutex: new Mutex(), timeout: null, reserve: 0 });
    }
    this.timeout = maxTimeout;
  }

  /**
   * @method
   * Locks mutex for a given user and starts a timeout. If mutex is not released in that timeout, mutex will be automatically
   * released
   * @param {Number} userIndex - user index to assign to a mutex
   * @returns {Number} 64 bit random number required to unlock mutex
   */
  async lock(userIndex) {
    const mutexIndex = userIndex % MAX_N_MUTEX;
    await this.mutexData[mutexIndex].mutex.acquire();
    this.mutexData[mutexIndex].reserve = Math.floor(Math.random() * MAX_RESERVE);
    this.mutexData[mutexIndex].timeout = setTimeout(
      () => {
        this.mutexData[mutexIndex].mutex.release();
        this.mutexData[mutexIndex].reserve = 0;
      },

      this.timeout,
    );

    return this.mutexData[mutexIndex].reserve;
  }

  expiration() {
    return this.timeout;
  }

  /**
   * @method
   * Unlocks mutex for a given user. User needs to provide obtained locking reserve to ensure only correct user can unlock
   * mutex. It also clears timeout
   * @param {Number} userIndex - user index that reserved mutex
   * @param {Number} lockingReserve - locking reserved assigned when acquiring mutex
   * @returns {boolean} indicating if release was or not sucessful
   */
  release(userIndex, lockingReserve) {
    if (!this.isLocked(userIndex, lockingReserve)) {
      return false;
    }
    const mutexIndex = userIndex % MAX_N_MUTEX;
    this.mutexData[mutexIndex].mutex.release();
    clearTimeout(this.mutexData[mutexIndex].timeout);
    return true;
  }

  /**
   * @method
   * Checks is mutex is locked by given user
   * @param {Number} userIndex - user index that reserved mutex
   * @param {Number} lockingReserve - locking reserved assigned when acquiring mutex
   * @returns {boolean} indicating if lock is locked by indicated user.
   */
  isLocked(userIndex, reserve) {
    const mutexIndex = userIndex % MAX_N_MUTEX;
    if (!this.mutexData[mutexIndex].mutex.isLocked()) {
      return false;
    }
    if (this.mutexData[mutexIndex].reserve !== reserve) {
      return false;
    }
    return true;
  }
}

export default ClusterMutex;
