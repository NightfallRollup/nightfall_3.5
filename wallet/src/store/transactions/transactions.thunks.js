/* ignore unused exports */
import * as Nf3 from 'nf3';
import { TRANSACTION_RETRY_PERIOD, TRANSACTION_MAX_RETRIES } from '../../constants';
import toBaseUnit from '../../utils/lib/utils';
import * as txActions from './transactions.actions';
import { addToken } from '../token/token.actions';

function txInstantWithdrawSubmit(withdrawTransactionHash, fee) {
  return async (dispatch, getState) => {
    const {
      login: { nf3 },
      transactions: { txPool },
    } = getState();
    nf3
      .requestInstantWithdrawal(withdrawTransactionHash, fee)
      .then(txReceipt => {
        // TODO dispatch error
        dispatch(txActions.txSuccess(Nf3.Constants.TX_TYPES.INSTANT_WITHDRAW, txReceipt));
      })
      .catch(err => {
        // TODO: Wait XXX time and retry YYY times. Else fail
        const withdrawTx = txPool.filter(
          tx => tx.withdrawTransactionHash === withdrawTransactionHash,
        )[0];
        if (withdrawTx.nRetries < TRANSACTION_MAX_RETRIES) {
          // update retries of this tx
          dispatch(txActions.txRetry(withdrawTransactionHash));
          setTimeout(() => {
            dispatch(txInstantWithdrawSubmit(withdrawTransactionHash, fee));
          }, TRANSACTION_RETRY_PERIOD);
        } else {
          dispatch(txActions.txFailed());
        }
        // TODO dispatch error
        console.log(err);
      });
  };
}

function txSubmit(txParams) {
  const tokenAmountWei = toBaseUnit(txParams.tokenAmount).toString();
  // TODO: offchain needs to be a value from form
  const offchain = false;

  return async (dispatch, getState) => {
    const {
      login: { nf3 },
      token: { tokenPool },
    } = getState();

    dispatch(txActions.txDispatch());
    switch (txParams.txType) {
      case Nf3.Constants.TX_TYPES.DEPOSIT:
        // TODO: dispatch error
        nf3
          .deposit(
            txParams.tokenAddress,
            txParams.tokenType,
            tokenAmountWei,
            txParams.tokenId,
            txParams.fee,
          )
          .then(txReceipt => {
            dispatch(txActions.txSuccess(Nf3.Constants.TX_TYPES.DEPOSIT, txReceipt));
            if (txParams.tokenType === Nf3.Constants.TOKEN_TYPE.ERC721) {
              // update tokenId
              const erc721Token = tokenPool.filter(
                token => token.tokenAddress === txParams.tokenAddress,
              );
              const tokenIdx = erc721Token[0].tokenId.findIndex(
                tokenId => tokenId === txParams.tokenId,
              );
              erc721Token[0].tokenId.splice(tokenIdx, 1);
              dispatch(
                addToken(
                  nf3.zkpKeys.compressedPkd,
                  erc721Token[0].tokenAddress,
                  erc721Token[0].tokenType,
                  erc721Token[0].tokenId,
                  erc721Token[0].tokenName,
                  '0',
                  '0',
                ),
              );
            }
            // TODO: dispatch error
            console.log(txReceipt);
          })
          .catch(err => {
            dispatch(txActions.txFailed());
            // TODO: dispatch error
            console.log(err);
          });
        break;

      case Nf3.Constants.TX_TYPES.TRANSFER:
        // TODO: dispatch error
        nf3
          .transfer(
            offchain,
            txParams.tokenAddress,
            txParams.tokenType,
            tokenAmountWei,
            txParams.tokenId,
            txParams.pkd,
            txParams.fee,
          )
          .then(txReceipt => {
            dispatch(txActions.txSuccess(Nf3.Constants.TX_TYPES.TRANSFER, txReceipt));
            // TODO: dispatch error
            console.log(txReceipt);
          })
          .catch(err => {
            dispatch(txActions.txFailed());
            // TODO: dispatch error
            console.log(err);
          });
        break;

      case Nf3.Constants.TX_TYPES.WITHDRAW:
      case Nf3.Constants.TX_TYPES.INSTANT_WITHDRAW:
        {
          // TODO: dispatch error
          const nRetries = 0;
          nf3
            .withdraw(
              offchain,
              txParams.tokenAddress,
              txParams.tokenType,
              tokenAmountWei,
              txParams.tokenId,
              txParams.ethereumAddress,
              txParams.fee,
            )
            .then(txReceipt => {
              const latestWithdrawTransactionHash = nf3.getLatestWithdrawHash();
              dispatch(
                txActions.txSuccess(
                  Nf3.Constants.TX_TYPES.WITHDRAW,
                  txReceipt,
                  latestWithdrawTransactionHash,
                  nRetries,
                ),
              );
              // TODO: dispatch error
              console.log(txReceipt);

              if (txParams.txType === Nf3.Constants.TX_TYPES.INSTANT_WITHDRAW) {
                dispatch(
                  txInstantWithdrawSubmit(
                    latestWithdrawTransactionHash,
                    txParams.instantWithdrawFee,
                  ),
                );
              }
            })
            .catch(err => {
              dispatch(txActions.txFailed());
              // TODO: dispatch error
              console.log(err);
            });
        }
        break;

      default:
        throw new Error('Unknown transaction', txParams.txType);
    }
  };
}

export { txSubmit, txInstantWithdrawSubmit };
