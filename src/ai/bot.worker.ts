import { chooseMove, type BotRequest } from './bot';

self.onmessage = (e: MessageEvent<{ id: number; req: BotRequest }>) => {
  const { id, req } = e.data;
  const reply = chooseMove(req);
  (self as unknown as Worker).postMessage({ id, reply });
};
