/* eslint-disable import/prefer-default-export */
/* eslint-disable no-unused-vars */
// Flag to enable/disable submitTransaction processing -> Debug
//  If disabled, transactiosn are stored in a temporary collection. When enabled
//  transactions from temporary collection are written on transactions collection.
//  This emulates the optimist receiving many transactions simultaneously
let _submitTransactionEnable = true;

export function submitTransactionEnable(enable) {
  _submitTransactionEnable = enable;
}
