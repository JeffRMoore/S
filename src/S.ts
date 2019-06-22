export interface S {
  // Computation root
  root<T>(fn: (dispose?: () => void) => T): T;

  // Computation constructors
  <T>(fn: () => T): () => T;
  <T>(fn: (v: T) => T, seed: T): () => T;
  on<T>(ev: () => any, fn: () => T): () => T;
  on<T>(ev: () => any, fn: (v: T) => T, seed: T, onchanges?: boolean): () => T;
  effect<T>(fn: () => T): void;
  effect<T>(fn: (v: T) => T, seed: T): void;

  // Data signal constructors
  data<T>(value: T): DataSignal<T>;
  value<T>(value: T, eq?: (a: T, b: T) => boolean): DataSignal<T>;

  // Batching changes
  freeze<T>(fn: () => T): T;

  // Sampling a signal
  sample<T>(fn: () => T): T;

  // Freeing external resources
  cleanup(fn: (final: boolean) => any): void;
}

export interface DataSignal<T> {
  (): T;
  (val: T): T;
}

// Public interface

// Computation constructors
// <T>(fn: () => T): () => T;
// <T>(fn: (v: T) => T, seed: T): () => T;
const S = <S>function S<T>(fn: (v: T | undefined) => T, value?: T): () => T {
  if (Owner === null)
    console.warn(
      "computations created without a root or parent will never be disposed"
    );

  const { node, value: _value } = makeComputationNode(fn, value, false, false);

  if (node === null) {
    return function computation() {
      return _value;
    };
  } else {
    return function computation() {
      return node!.current();
    };
  }
};

// compatibility with commonjs systems that expect default export to be at require('s.js').default rather than just require('s-js')
Object.defineProperty(S, "default", { value: S });

export default S;

// Computation root
// root<T>(fn: (dispose?: () => void) => T): T;
S.root = function root<T>(fn: (dispose: () => void) => T): T {
  const owner = Owner;
  const disposer =
    fn.length === 0
      ? null
      : function _dispose() {
          if (root === null) {
            // nothing to dispose
          } else if (RunningClock !== null) {
            RootClock.disposes.add(root);
          } else {
            dispose(root);
          }
        };
  let root = disposer === null ? UNOWNED : getCandidateNode();
  let result: T;

  Owner = root;

  try {
    result = disposer === null ? (fn as any)() : fn(disposer);
  } finally {
    Owner = owner;
  }

  if (
    disposer !== null &&
    recycleOrClaimNode(root, null as any, undefined, true)
  ) {
    root = null!;
  }

  return result;
};

//   on<T>(ev: () => any, fn: () => T): () => T;
//   on<T>(ev: () => any, fn: (v: T) => T, seed: T, onchanges?: boolean): () => T;
S.on = function on<T>(
  ev: () => any,
  fn: (v?: T) => T,
  seed?: T,
  onchanges?: boolean
) {
  if (Array.isArray(ev)) ev = callAll(ev);
  onchanges = !!onchanges;

  return S(on, seed);

  function on(value: T | undefined) {
    const listener = Listener;
    ev();
    if (onchanges) onchanges = false;
    else {
      Listener = null;
      value = fn(value);
      Listener = listener;
    }
    return value;
  }
};

function callAll(ss: (() => any)[]) {
  return function all() {
    for (let i = 0; i < ss.length; i++) ss[i]();
  };
}

// Not documented
// No tests
// Used only in the benchmarks
//   effect<T>(fn: () => T): void;
//   effect<T>(fn: (v: T) => T, seed: T): void;
S.effect = function effect<T>(fn: (v: T | undefined) => T, value?: T): void {
  makeComputationNode(fn, value, false, false);
};

// Data signal constructors
// data<T>(value: T): DataSignal<T>;
S.data = function data<T>(value: T): (value?: T) => T {
  const node = new DataNode(value);

  return function data(value?: T): T {
    if (arguments.length === 0) {
      return node.current();
    } else {
      return node.next(value);
    }
  };
};

// Data signal constructors
// value<T>(value: T, eq?: (a: T, b: T) => boolean): DataSignal<T>;
S.value = function value<T>(
  current: T,
  eq?: (a: T, b: T) => boolean
): DataSignal<T> {
  const node = new DataNode(current);
  let age = -1;
  return function value(update?: T) {
    if (arguments.length === 0) {
      return node.current();
    } else {
      const same = eq ? eq(current, update!) : current === update;
      if (!same) {
        const time = RootClock.time;
        if (age === time)
          throw new Error(
            "conflicting values: " + update + " is not the same as " + current
          );
        age = time;
        current = update!;
        node.next(update!);
      }
      return update!;
    }
  };
};

// Batching changes
// freeze<T>(fn: () => T): T;
S.freeze = function freeze<T>(fn: () => T): T {
  let result: T = undefined!;

  if (RunningClock !== null) {
    result = fn();
  } else {
    RunningClock = RootClock;
    RunningClock.changes.reset();

    try {
      result = fn();
      event();
    } finally {
      RunningClock = null;
    }
  }

  return result;
};

// Sampling a signal
// sample<T>(fn: () => T): T;
S.sample = function sample<T>(fn: () => T): T {
  let result: T;
  const listener = Listener;

  Listener = null;
  result = fn();
  Listener = listener;

  return result;
};

// Freeing external resources
// cleanup(fn: (final: boolean) => any): void;
// No tests
// Not part of benchmark
S.cleanup = function cleanup(fn: (final: boolean) => void): void {
  if (Owner === null)
    console.warn("cleanups created without a root or parent will never be run");
  else if (Owner.cleanups === null) Owner.cleanups = [fn];
  else Owner.cleanups.push(fn);
};

// Internal implementation

/// Graph classes and operations
class Clock {
  time = 0;

  changes = new Queue<DataNode>(); // batched changes to data nodes
  updates = new Queue<ComputationNode>(); // computations to update
  disposes = new Queue<ComputationNode>(); // disposals to run after current batch of updates finishes
}

class DataNode {
  pending = NOTPENDING as any;
  log = null as Log | null;

  constructor(public value: any) {}

  current() {
    if (Listener !== null) {
      logDataRead(this);
    }
    return this.value;
  }

  next(value: any) {
    if (RunningClock !== null) {
      if (this.pending !== NOTPENDING) {
        // value has already been set once, check for conflicts
        if (value !== this.pending) {
          throw new Error(
            "conflicting changes: " + value + " !== " + this.pending
          );
        }
      } else {
        // add to list of changes
        this.pending = value;
        RootClock.changes.add(this);
      }
    } else {
      // not batching, respond to change now
      if (this.log !== null) {
        this.pending = value;
        RootClock.changes.add(this);
        event();
      } else {
        this.value = value;
      }
    }
    return value!;
  }
}

class ComputationNode {
  fn = null as ((v: any) => any) | null;
  value = undefined as any;
  age = -1;
  state = CURRENT;
  source1 = null as null | Log;
  source1slot = 0;
  sources = null as null | Log[];
  sourceslots = null as null | number[];
  log = null as Log | null;
  owned = null as ComputationNode[] | null;
  cleanups = null as (((final: boolean) => void)[]) | null;

  constructor() {}

  current() {
    if (Listener !== null) {
      if (this.age === RootClock.time) {
        if (this.state === RUNNING) throw new Error("circular dependency");
        else updateNode(this); // checks for state === STALE internally, so don't need to check here
      }
      logComputationRead(this);
    }

    return this.value;
  }
}

class Log {
  node1 = null as null | ComputationNode;
  node1slot = 0;
  nodes = null as null | ComputationNode[];
  nodeslots = null as null | number[];
}

class Queue<T> {
  items = [] as T[];
  count = 0;

  reset() {
    this.count = 0;
  }

  add(item: T) {
    this.items[this.count++] = item;
  }

  run(fn: (item: T) => void) {
    const items = this.items;
    for (let i = 0; i < this.count; i++) {
      fn(items[i]!);
      items[i] = null!;
    }
    this.count = 0;
  }
}

// Constants
const NOTPENDING = {};
const CURRENT = 0;
const STALE = 1;
const RUNNING = 2;
const UNOWNED = new ComputationNode();

// "Globals" used to keep track of current system state
var RootClock = new Clock();
var RunningClock = null as Clock | null; // currently running clock
var Listener = null as ComputationNode | null; // currently listening computation
var Owner = null as ComputationNode | null; // owner for new computations
var LastNode = null as ComputationNode | null; // cached unused node, for re-use

// Functions
const makeComputationNodeResult = {
  node: null as null | ComputationNode,
  value: undefined as any
};
function makeComputationNode<T>(
  fn: (v: T | undefined) => T,
  value: T | undefined,
  orphan: boolean,
  sample: boolean
): { node: ComputationNode | null; value: T } {
  const node = getCandidateNode();
  const owner = Owner;
  const listener = Listener;
  const toplevel = RunningClock === null;

  Owner = node;
  Listener = sample ? null : node;

  if (toplevel) {
    value = execToplevelComputation(fn, value);
  } else {
    value = fn(value);
  }

  Owner = owner;
  Listener = listener;

  const recycled = recycleOrClaimNode(node, fn, value, orphan);

  if (toplevel) finishToplevelComputation(owner, listener);

  makeComputationNodeResult.node = recycled ? null : node;
  makeComputationNodeResult.value = value!;

  return makeComputationNodeResult;
}

function execToplevelComputation<T>(
  fn: (v: T | undefined) => T,
  value: T | undefined
) {
  RunningClock = RootClock;
  RootClock.changes.reset();
  RootClock.updates.reset();

  try {
    return fn(value);
  } finally {
    Owner = Listener = RunningClock = null;
  }
}

function finishToplevelComputation(
  owner: ComputationNode | null,
  listener: ComputationNode | null
) {
  if (RootClock.changes.count > 0 || RootClock.updates.count > 0) {
    RootClock.time++;
    try {
      run(RootClock);
    } finally {
      RunningClock = null;
      Owner = owner;
      Listener = listener;
    }
  }
}

function getCandidateNode() {
  let node = LastNode;
  if (node === null) node = new ComputationNode();
  else LastNode = null;
  return node;
}

function recycleOrClaimNode<T>(
  node: ComputationNode,
  fn: (v: T | undefined) => T,
  value: T,
  orphan: boolean
) {
  const _owner = orphan || Owner === null || Owner === UNOWNED ? null : Owner;
  const recycle =
    node.source1 === null &&
    ((node.owned === null && node.cleanups === null) || _owner !== null);
  let i: number;

  if (recycle) {
    LastNode = node;

    if (_owner !== null) {
      if (node.owned !== null) {
        if (_owner.owned === null) _owner.owned = node.owned;
        else
          for (i = 0; i < node.owned.length; i++) {
            _owner.owned.push(node.owned[i]);
          }
        node.owned = null;
      }

      if (node.cleanups !== null) {
        if (_owner.cleanups === null) _owner.cleanups = node.cleanups;
        else
          for (i = 0; i < node.cleanups.length; i++) {
            _owner.cleanups.push(node.cleanups[i]);
          }
        node.cleanups = null;
      }
    }
  } else {
    node.fn = fn;
    node.value = value;
    node.age = RootClock.time;

    if (_owner !== null) {
      if (_owner.owned === null) _owner.owned = [node];
      else _owner.owned.push(node);
    }
  }

  return recycle;
}

function logRead(from: Log) {
  const to = Listener!;
  let fromslot: number;
  const toslot =
    to.source1 === null ? -1 : to.sources === null ? 0 : to.sources.length;

  if (from.node1 === null) {
    from.node1 = to;
    from.node1slot = toslot;
    fromslot = -1;
  } else if (from.nodes === null) {
    from.nodes = [to];
    from.nodeslots = [toslot];
    fromslot = 0;
  } else {
    fromslot = from.nodes.length;
    from.nodes.push(to);
    from.nodeslots!.push(toslot);
  }

  if (to.source1 === null) {
    to.source1 = from;
    to.source1slot = fromslot;
  } else if (to.sources === null) {
    to.sources = [from];
    to.sourceslots = [fromslot];
  } else {
    to.sources.push(from);
    to.sourceslots!.push(fromslot);
  }
}

function logDataRead(data: DataNode) {
  if (data.log === null) data.log = new Log();
  logRead(data.log);
}

function logComputationRead(node: ComputationNode) {
  if (node.log === null) node.log = new Log();
  logRead(node.log);
}

function event() {
  // b/c we might be under a top level S.root(), have to preserve current root
  const owner = Owner;
  RootClock.updates.reset();
  RootClock.time++;
  try {
    run(RootClock);
  } finally {
    RunningClock = Listener = null;
    Owner = owner;
  }
}

function run(clock: Clock) {
  const running = RunningClock;
  let count = 0;

  RunningClock = clock;

  clock.disposes.reset();

  // for each batch ...
  while (
    clock.changes.count !== 0 ||
    clock.updates.count !== 0 ||
    clock.disposes.count !== 0
  ) {
    if (count > 0)
      // don't tick on first run, or else we expire already scheduled updates
      clock.time++;

    clock.changes.run(applyDataChange);
    clock.updates.run(updateNode);
    clock.disposes.run(dispose);

    // if there are still changes after excessive batches, assume runaway
    if (count++ > 1e5) {
      throw new Error("Runaway clock detected");
    }
  }

  RunningClock = running;
}

function applyDataChange(data: DataNode) {
  data.value = data.pending;
  data.pending = NOTPENDING;
  if (data.log) markComputationsStale(data.log);
}

function markComputationsStale(log: Log) {
  const node1 = log.node1;
  const nodes = log.nodes;

  // mark all downstream nodes stale which haven't been already
  if (node1 !== null) markNodeStale(node1);
  if (nodes !== null) {
    for (let i = 0, len = nodes.length; i < len; i++) {
      markNodeStale(nodes[i]);
    }
  }
}

function markNodeStale(node: ComputationNode) {
  const time = RootClock.time;
  if (node.age < time) {
    node.age = time;
    node.state = STALE;
    RootClock.updates.add(node);
    if (node.owned !== null) markOwnedNodesForDisposal(node.owned);
    if (node.log !== null) markComputationsStale(node.log);
  }
}

function markOwnedNodesForDisposal(owned: ComputationNode[]) {
  for (let i = 0; i < owned.length; i++) {
    const child = owned[i];
    child.age = RootClock.time;
    child.state = CURRENT;
    if (child.owned !== null) markOwnedNodesForDisposal(child.owned);
  }
}

function updateNode(node: ComputationNode) {
  if (node.state === STALE) {
    const owner = Owner;
    const listener = Listener;

    Owner = Listener = node;

    node.state = RUNNING;
    cleanupComputationNode(node, false);
    node.value = node.fn!(node.value);
    node.state = CURRENT;

    Owner = owner;
    Listener = listener;
  }
}

function cleanupComputationNode(node: ComputationNode, final: boolean) {
  const source1 = node.source1;
  const sources = node.sources;
  const sourceslots = node.sourceslots;
  const cleanups = node.cleanups;
  const owned = node.owned;
  let i: number;
  let len: number;

  if (cleanups !== null) {
    for (i = 0; i < cleanups.length; i++) {
      cleanups[i](final);
    }
    node.cleanups = null;
  }

  if (owned !== null) {
    for (i = 0; i < owned.length; i++) {
      dispose(owned[i]);
    }
    node.owned = null;
  }

  if (source1 !== null) {
    cleanupSource(source1, node.source1slot);
    node.source1 = null;
  }
  if (sources !== null) {
    for (i = 0, len = sources.length; i < len; i++) {
      cleanupSource(sources.pop()!, sourceslots!.pop()!);
    }
  }
}

function cleanupSource(source: Log, slot: number) {
  const nodes = source.nodes!;
  const nodeslots = source.nodeslots!;
  let last: ComputationNode;
  let lastslot: number;
  if (slot === -1) {
    source.node1 = null;
  } else {
    last = nodes.pop()!;
    lastslot = nodeslots.pop()!;
    if (slot !== nodes.length) {
      nodes[slot] = last;
      nodeslots[slot] = lastslot;
      if (lastslot === -1) {
        last.source1slot = slot;
      } else {
        last.sourceslots![lastslot] = slot;
      }
    }
  }
}

function dispose(node: ComputationNode) {
  node.fn = null;
  node.log = null;
  cleanupComputationNode(node, true);
}
