/** Pure JSON-tree helpers shared by the local stores and the SharedWorker "server". */

export type Json = unknown;
export type Tree = Record<string, Json>;

/** A single write: `value` null deletes; may contain {'.sv':'timestamp'} sentinels. */
export interface WriteOp {
  path: string;
  value: Json;
}

/** Compare-and-set guard: apply only if the value at `path` still serialises to `expect`. */
export interface Cas {
  path: string;
  expect: string;
}

export const segments = (path: string) => path.split('/').filter(Boolean);

export const clone = <T>(v: T): T => (v === undefined ? (null as T) : JSON.parse(JSON.stringify(v)));

export function getAt(tree: Json, segs: string[]): Json {
  let cur: Json = tree;
  for (const s of segs) {
    if (cur === null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, Json>)[s];
    if (cur === undefined) return null;
  }
  return cur ?? null;
}

/** Firebase never stores empty objects or nulls; arrays become objects. */
export function normalize(v: Json): Json {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) v = Object.fromEntries(v.map((x, i) => [String(i), x]));
  const out: Record<string, Json> = {};
  for (const [k, x] of Object.entries(v as Record<string, Json>)) {
    const n = normalize(x);
    if (n !== null) out[k] = n;
  }
  return Object.keys(out).length ? out : null;
}

export function setAt(tree: Tree, segs: string[], value: Json): Tree {
  if (!segs.length) return (normalize(value) as Tree) ?? {};
  const stack: [Record<string, Json>, string][] = [];
  let cur: Record<string, Json> = tree;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i];
    let next = cur[s];
    if (next === null || typeof next !== 'object') {
      next = {};
      cur[s] = next;
    }
    stack.push([cur, s]);
    cur = next as Record<string, Json>;
  }
  const last = segs[segs.length - 1];
  const n = normalize(value);
  if (n === null) delete cur[last];
  else cur[last] = n;
  for (let i = stack.length - 1; i >= 0; i--) {
    const [parent, key] = stack[i];
    const child = parent[key] as Record<string, Json>;
    if (child && typeof child === 'object' && Object.keys(child).length === 0) delete parent[key];
  }
  return tree;
}

export function resolveServerValues(v: Json, now: number): Json {
  if (v === null || typeof v !== 'object') return v;
  const o = v as Record<string, Json>;
  if (o['.sv'] === 'timestamp' && Object.keys(o).length === 1) return now;
  const out: Record<string, Json> = {};
  for (const [k, x] of Object.entries(o)) out[k] = resolveServerValues(x, now);
  return out;
}

export const casOk = (tree: Tree, cas?: Cas) => !cas || JSON.stringify(getAt(tree, segments(cas.path))) === cas.expect;

/** Apply ops in order on a copy of `tree`; returns the new tree. */
export function applyOps(tree: Tree, ops: WriteOp[], now: number): Tree {
  let t = clone(tree) ?? {};
  for (const op of ops) t = setAt(t, segments(op.path), resolveServerValues(clone(op.value), now));
  return t;
}
