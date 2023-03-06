/* eslint-disable no-undef */
// BUFFERED TRANSACTIONS CONLLECTION is a test collection to temporarily store
//  transactions so that we can emulate the optimist receiving all at once
export async function saveBufferedTransaction(_transaction) {
  const transaction = {
    _id: _transaction.transactionHash,
    ..._transaction,
  };
  const connection = await mongo.connection(MONGO_URL);
  const db = connection.db(OPTIMIST_DB);

  db.collection(BUFFERED_TRANSACTIONS_COLLECTION).insertOne(transaction);
}
/**
    How many transactions in BUFFERED TRANSACTIONS COLLECTION
    */
export async function numberOfBufferedTransactions() {
  const connection = await mongo.connection(MONGO_URL);
  const db = connection.db(OPTIMIST_DB);
  try {
    return db.collection(BUFFERED_TRANSACTIONS_COLLECTION).countDocuments();
  } catch {
    return 0;
  }
}

export async function findAndDeleteAllBufferedTransactions() {
  const connection = await mongo.connection(MONGO_URL);
  const db = connection.db(OPTIMIST_DB);
  let returnedTransactions;
  const nElems = await numberOfBufferedTransactions();
  if (nElems) {
    returnedTransactions = await db.collection(BUFFERED_TRANSACTIONS_COLLECTION).find().toArray();
    db.collection(BUFFERED_TRANSACTIONS_COLLECTION).drop();
  } else {
    returnedTransactions = [];
  }
  return returnedTransactions;
}
