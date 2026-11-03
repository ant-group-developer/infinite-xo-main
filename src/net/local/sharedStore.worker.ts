/// <reference lib="webworker" />
/**
 * The local "server": one SharedWorker shared by every tab of the dev app.
 * All writes are applied here, in order, then the new tree is broadcast to
 * every tab. Compare-and-set lets tabs implement transactions with retries.
 */
import { applyOps, casOk, type Cas, type Tree, type WriteOp } from './tree';

declare const self: SharedWorkerGlobalScope;

let tree: Tree = {};
let seeded = false;
const ports = new Set<MessagePort>();

type Msg =
  | { type: 'hello'; saved: Tree | null }
  | { type: 'apply'; id: number; ops: WriteOp[]; cas?: Cas }
  | { type: 'bye' };

self.onconnect = (e: MessageEvent) => {
  const port = e.ports[0];
  ports.add(port);
  port.onmessage = (m: MessageEvent<Msg>) => {
    const msg = m.data;
    if (msg.type === 'hello') {
      if (!seeded) {
        tree = msg.saved ?? {};
        seeded = true;
      }
      port.postMessage({ type: 'tree', tree });
    } else if (msg.type === 'apply') {
      if (!casOk(tree, msg.cas)) {
        port.postMessage({ type: 'ack', id: msg.id, ok: false });
        return;
      }
      tree = applyOps(tree, msg.ops, Date.now());
      for (const p of ports) p.postMessage({ type: 'tree', tree });
      port.postMessage({ type: 'ack', id: msg.id, ok: true });
    } else if (msg.type === 'bye') {
      ports.delete(port);
    }
  };
  port.start();
};
