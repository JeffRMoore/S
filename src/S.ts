export interface ReadableDataSignal<T> {
  // The Getter Signature
  (): T;
}

export interface MutableDataSignal<T> {
  // The Setter Signature
  (nextValue: T): T;
}

export interface DataSignal<T> {
  // The Getter Signature
  (): T;

  // The Setter Signature
  (nextValue: T): T;
}

// Public interface

type ReducerFn<T> = (v: T) => T;
type BasicComputationFn<T> = () => T;

// TODO: Express ComputationFn as a union of ReducerFn and BasicComputationFn
// type ComputationFn<T> = ReducerFn<T> | BasicComputationFn<T>;
// Also sometimes represented as (v: T | undefined) => T
type ComputationFn<T> = (v?: T) => T;

// Computation constructors
export function createMemo<T>(fn: BasicComputationFn<T>): ReadableDataSignal<T>;
export function createMemo<T>(fn: ReducerFn<T>, seed: T): ReadableDataSignal<T>;
export function createMemo<T>(
  fn: ComputationFn<T>,
  value?: T
): ReadableDataSignal<T> {
  if (Owner === null)
    console.warn(
      "computations created without a root or parent will never be disposed"
    );

  const { node, value: _value } = makeComputationNode(fn, value, false, false);

  if (node === null) {
    return function resultGetter() {
      return _value;
    };
  } else {
    return function resultGetter() {
      return node!.current();
    };
  }
}

type DisposalFn<T> = (dispose: () => void) => T;

// Computation root
// TODO: Resolve optionality of dispose in type definition
// TODO: Understand the dispose case -- figure out if this is a RootComputation type
// root<T>(fn: (dispose?: () => void) => T): T;
export function createRoot<T>(fn: DisposalFn<T>): T {
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
}

type DataSignalSpec<T> = ReadableDataSignal<T>[] | ReadableDataSignal<T>[];

function composeDependencies(ss: ReadableDataSignal<any>[]) {
  return function readAll() {
    for (let i = 0; i < ss.length; i++) ss[i]();
  };
}

// TODO: overload definitions
// TODO: Ruturn type not specified (ANY)
// TODO: Remove boolean parameter: seed is unnecessary when a basicComputation is used with a defer parameter
// TODO: Just WHAT IS this expected to return???
//   on<T>(ev: () => any, fn: () => T): () => T;
//   on<T>(ev: () => any, fn: (v: T) => T, seed: T, onchanges?: boolean): () => T;
/*
export function createDependentEffect<T>(
    dependsOn: DataSignalSpec<any>,
    fn: BasicComputationFn<T>,
    seed?: T,
    defer?: boolean
): ReadableDataSignal<T>;
export function createDependentEffect<T>(
    dependsOn: DataSignalSpec<any>,
    fn: ReducerFn<T>,
    seed: T,
    defer?: boolean
): ReadableDataSignal<T> ;
*/
export function createDependentEffect<T>(
  dependsOn: DataSignalSpec<any>,
  fn: ComputationFn<T>,
  seed?: T,
  defer?: boolean
) {
  let forceDependencies = Array.isArray(dependsOn)
    ? composeDependencies(dependsOn)
    : dependsOn;
  let waiting = !!defer;

  return createMemo(on, seed);

  // TODO: Ruturn type no specified (ANY)
  function on(value?: T) {
    const listener = Listener;
    forceDependencies();
    if (waiting) {
      waiting = false;
    } else {
      Listener = null;
      value = fn(value);
      Listener = listener;
    }
    return value;
  }
}

// Not documented
// No tests
// Used only in the benchmarks
export function createEffect<T>(fn: BasicComputationFn<T>): void;
export function createEffect<T>(fn: ReducerFn<T>, seed: T): void;
export function createEffect<T>(fn: ComputationFn<T>, value?: T): void {
  makeComputationNode(fn, value, false, false);
}

// Data signal constructors
export function createSignal<T>(initialValue: T): DataSignal<T> {
  const node = new DataNode(initialValue);

  return function dataSignal(nextValue?: T): T {
    if (arguments.length === 0) {
      return node.current();
    } else {
      return node.next(nextValue);
    }
  };
}

// Data signal constructors
// value<T>(value: T, eq?: (a: T, b: T) => boolean): DataSignal<T>;
export function createValueSignal<T>(
  initialValue: T,
  eq?: (a: T, b: T) => boolean
): DataSignal<T> {
  const node = new DataNode(initialValue);
  let age = -1;
  let currentValue = initialValue;

  return function valueSignal(nextValue?: T) {
    if (arguments.length === 0) {
      return node.current();
    } else {
      const same = eq
        ? eq(currentValue, nextValue!)
        : currentValue === nextValue;
      if (!same) {
        const time = RootClock.time;
        if (age === time)
          throw new Error(
            "conflicting values: " +
              nextValue +
              " is not the same as " +
              currentValue
          );
        age = time;
        currentValue = nextValue!;
        node.next(nextValue!);
      }
      return nextValue!;
    }
  };
}

// Batching changes
export function freeze<T>(fn: BasicComputationFn<T>): T {
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
}

// Sampling a signal
export function sample<T>(fn: BasicComputationFn<T>): T {
  let result: T;
  const listener = Listener;

  Listener = null;
  result = fn();
  Listener = listener;

  return result;
}

type cleanUpFn = (final: boolean) => void;

// Freeing external resources
// cleanup(fn: (final: boolean) => any): void;
// No tests
// Not part of benchmark
export function onCleanup(fn: cleanUpFn): void {
  if (Owner === null)
    console.warn("cleanups created without a root or parent will never be run");
  else if (Owner.cleanups === null) Owner.cleanups = [fn];
  else Owner.cleanups.push(fn);
}

// Internal implementation

/// Graph classes and operations
class Clock {
  time = 0;

  changes = new Queue<DataNode>(); // batched changes to data nodes
  updates = new Queue<ComputationNode>(); // computations to update
  disposes = new Queue<ComputationNode>(); // disposals to run after current batch of updates finishes
}

const NOTHING_PENDING = {};

/**
 * Represents a buffered data value which logReads and log
 */
class DataNode {
  // value: any;

  /**
   * logDatRead will create the log if necessary
   * dispose will remove it when it is no longer needed
   */
  log = null as Log | null;

  /**
   * The value which is pending for next clock cycle
   * applyDataChange will change this to NOTHING_PENDING, a unique sentinel
   * Otherwise, the value is set in the mutator method.
   */
  pending = NOTHING_PENDING as any;

  constructor(public value: any) {}

  current() {
    if (Listener !== null) {
      if (this.log === null) this.log = new Log();
      this.log.logRead(Listener);
    }
    return this.value;
  }

  next(value: any) {
    // TODO: Guard clauses?
    if (RunningClock !== null) {
      if (this.pending !== NOTHING_PENDING) {
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
      if (this.log !== null) {
        this.pending = value;
        RootClock.changes.add(this);
        event();
      } else {
        // not batching, respond to change now
        this.value = value;
      }
    }
    return value!; // TODO: This declaration seems type-shady is this really true or necessary?
  }

  applyPendingChange() {
    this.value = this.pending;
    this.pending = NOTHING_PENDING;
  }
}

class ComputationNode {
  value = undefined as any;
  log = null as Log | null;
  fn = null as ComputationFn<any> | null;
  age = -1;
  state = CURRENT;
  source1 = null as null | Log;
  source1slot = 0;
  sources = null as null | Log[];
  sourceslots = null as null | number[];
  owned = null as ComputationNode[] | null;
  cleanups = null as cleanUpFn[] | null;

  constructor() {}

  current() {
    if (Listener !== null) {
      if (this.age === RootClock.time) {
        if (this.state === RUNNING) throw new Error("circular dependency");
        else updateNode(this); // checks for state === STALE internally, so don't need to check here
      }
      if (this.log === null) this.log = new Log();
      this.log.logRead(Listener);
    }

    return this.value;
  }

  logSource(from: Log, fromslot: number) {
    if (this.source1 === null) {
      this.source1 = from;
      this.source1slot = fromslot;
      return -1;
    } else if (this.sources === null) {
      this.sources = [from];
      this.sourceslots = [fromslot];
      return 0;
    } else {
      this.sources.push(from);
      this.sourceslots!.push(fromslot);
      return this.sources.length - 1;
    }
  }
}

/**
 * A list of which ComputationNodes have "Seen" the Signal that the log is attached to
 * Still no idea what a slot is.  (maybe an optimization during cleanup to avoid doing a "search")
 * Maybe this should just link to a data structure {Node, Slot}
 * Maybe a slab allocator?
 */
class Log {
  node1 = null as null | ComputationNode;
  node1slot = 0;
  nodes = null as null | ComputationNode[];
  nodeslots = null as null | number[];

  logRead(to: ComputationNode) {
    let fromslot =
      this.node1 === null ? -1 : this.nodes === null ? 0 : this.nodes.length;
    const toslot = to.logSource(this, fromslot);

    if (this.node1 === null) {
      this.node1 = to;
      this.node1slot = toslot;
    } else if (this.nodes === null) {
      this.nodes = [to];
      this.nodeslots = [toslot];
    } else {
      this.nodes.push(to);
      this.nodeslots!.push(toslot);
    }
  }

  cleanupSource(slot: number) {
    const nodes = this.nodes!;
    const nodeslots = this.nodeslots!;
    let last: ComputationNode;
    let lastslot: number;
    if (slot === -1) {
      this.node1 = null;
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
const CURRENT = 0;
const STALE = 1;
const RUNNING = 2;
const UNOWNED = new ComputationNode();

// "Globals" used to keep track of current system state
let RootClock = new Clock();
let RunningClock = null as Clock | null; // currently running clock
let Listener = null as ComputationNode | null; // currently listening computation
let Owner = null as ComputationNode | null; // owner for new computations
let LastNode = null as ComputationNode | null; // cached unused node, for re-use

// Functions
const makeComputationNodeResult = {
  node: null as null | ComputationNode,
  value: undefined as any
};
function makeComputationNode<T>(
  fn: ComputationFn<T>,
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
  fn: ComputationFn<T>,
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
  fn: ComputationFn<T>,
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

function event() {
  // b/c we might be under a top level createRoot(), have to preserve current root
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
  data.applyPendingChange();
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

// Only called from ComputationNode.current
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
    source1.cleanupSource(node.source1slot);
    node.source1 = null;
  }
  if (sources !== null) {
    // Move Cleanup All Sources
    for (i = 0, len = sources.length; i < len; i++) {
      const source = sources.pop()!;
      source.cleanupSource(sourceslots!.pop()!);
    }
  }
}

function dispose(node: ComputationNode) {
  node.fn = null;
  node.log = null;
  cleanupComputationNode(node, true);
}
