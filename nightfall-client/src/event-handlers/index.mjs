import { startEventQueue } from './subscribe.mjs';
import rollbackEventHandler from './rollback.mjs';

const eventHandlers = {
  Rollback: rollbackEventHandler,
  priority: {
    Rollback: 0,
  },
};

export { startEventQueue, eventHandlers };
