import express from 'express';
import startProver from '../utils/startProver.mjs';

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    await startProver();
    res.send('Prover started');
  } catch (err) {
    next(err);
  }
});

export default router;
