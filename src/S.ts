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
  return RootClock.createMemo(fn, value);
}

type DisposalFn<T> = (dispose: () => void) => T;

// Computation root
// TODO: Resolve optionality of dispose in type definition
// TODO: Understand the dispose case -- figure out if this is a RootComputation type
// TODO: Move this logic to the Clock class
// root<T>(fn: (dispose?: () => void) => T): T;
export function createRoot<T>(fn: DisposalFn<T>): T {
  if (fn.length === 0) {
    return RootClock.runUnowned(fn);
  } else {
    return RootClock.runRoot(fn);
  }
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
  RootClock.createEffect(fn, value);
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
  return RootClock.runFrozen(fn);
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

  isRunning = false;

  // called from finishToplevelComputation
  // called from event
  run() {
    const running = this.isRunning;
    let count = 0;

    this.isRunning = true;

    // TODO: Why do we throw away any disposes we have here?
    this.disposes.reset();

    // for each batch ...
    while (
      this.changes.count !== 0 ||
      this.updates.count !== 0 ||
      this.disposes.count !== 0
    ) {
      if (count > 0)
        // don't tick on first run, or else we expire already scheduled updates
        this.time++;

      this.changes.run(applyDataChange);
      this.updates.run(updateNode);
      this.disposes.run(dispose);

      // if there are still changes after excessive batches, assume runaway
      if (count++ > 1e5) {
        throw new Error("Runaway clock detected");
      }
    }

    this.isRunning = running;
  }

  // called from freeze
  runFrozen<T>(fn: BasicComputationFn<T>): T {
    let result: T = undefined!;

    if (this.isRunning) {
      result = fn();
    } else {
      this.isRunning = true;

      // TODO: is it safe to discard changes here?
      this.changes.reset();

      try {
        result = fn();
        this.event();
      } finally {
        this.isRunning = false;
      }
    }

    return result;
  }

  // called from createRoot
  runUnowned<T>(fn: DisposalFn<T>): T {
    const owner = Owner;
    let result: T;

    Owner = UNOWNED;

    try {
      result = (fn as any)();
    } finally {
      Owner = owner;
    }

    return result;
  }

  // called from createRoot
  runRoot<T>(fn: DisposalFn<T>): T {
    const owner = Owner;
    let root = getCandidateNode();
    let result: T;
    let clock = this;

    Owner = root;

    try {
      result = fn(function _dispose() {
        if (root === null) {
          // nothing to dispose
        } else if (clock.isRunning) {
          clock.disposes.add(root);
        } else {
          dispose(root);
        }
      });
    } finally {
      Owner = owner;
    }

    if (recycleOrClaimNode(root, null as any, undefined, true)) {
      root = null!;
    }

    return result;
  }

  // called from createEffect
  // called from createMemo
  execToplevelComputation<T>(fn: ComputationFn<T>, value: T | undefined) {
    this.isRunning = true;
    // TODO: What happens to the disposes?
    this.changes.reset();
    this.updates.reset();

    try {
      return fn(value);
    } finally {
      Owner = Listener = null;
      this.isRunning = false;
    }
  }

  // called from createEffect
  // called from createMemo
  finishToplevelComputation(
    owner: ComputationNode | null,
    listener: ComputationNode | null
  ) {
    if (this.changes.count > 0 || this.updates.count > 0) {
      this.time++;
      try {
        this.run();
      } finally {
        this.isRunning = false;
        Owner = owner;
        Listener = listener;
      }
    }
  }

  // called from createEffect
  createEffect<T>(fn: ComputationFn<T>, value: T | undefined): void {
    const node = getCandidateNode();
    const owner = Owner;
    const listener = Listener;

    Owner = node;
    Listener = node;

    if (!this.isRunning) {
      value = this.execToplevelComputation(fn, value);
    } else {
      value = fn(value);
    }

    Owner = owner;
    Listener = listener;

    recycleOrClaimNode(node, fn, value, false);

    if (!this.isRunning) this.finishToplevelComputation(owner, listener);
  }

  // called from createMemo
  createMemo<T>(
    fn: ComputationFn<T>,
    value: T | undefined
  ): ReadableDataSignal<T> {
    const node = getCandidateNode();
    const owner = Owner;
    const listener = Listener;

    if (Owner === null)
      console.warn(
        "computations created without a root or parent will never be disposed"
      );

    Owner = node;
    Listener = node;

    if (!this.isRunning) {
      value = RootClock.execToplevelComputation(fn, value);
    } else {
      value = fn(value);
    }

    Owner = owner;
    Listener = listener;

    const recycled = recycleOrClaimNode(node, fn, value, false);

    if (!this.isRunning) RootClock.finishToplevelComputation(owner, listener);

    let _node = recycled ? null : node;
    let _value = value!;

    if (_node === null) {
      return function resultGetter() {
        return _value;
      };
    } else {
      return function resultGetter() {
        return _node!.current();
      };
    }
  }

  // called from runFrozen
  // called from DataNode.next
  event() {
    // b/c we might be under a top level createRoot(), have to preserve current root
    const owner = Owner;
    // TODO: Why is it safe to reset updates?
    this.updates.reset();
    this.time++;
    try {
      this.run();
    } finally {
      Owner = owner;
      Listener = null;
      this.isRunning = false;
    }
  }
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
    if (RootClock.isRunning) {
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
        RootClock.event();
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
    if (this.log) this.log.markComputationsStale();
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

  markNodeStale() {
    const time = RootClock.time;
    if (this.age < time) {
      this.age = time;
      this.state = STALE;
      RootClock.updates.add(this);
      if (this.owned !== null) markOwnedNodesForDisposal(this.owned);
      if (this.log !== null) this.log.markComputationsStale();
    }
  }

  updateNode() {
    if (this.state === STALE) {
      const owner = Owner;
      const listener = Listener;

      Owner = Listener = this;

      this.state = RUNNING;
      this.cleanupComputationNode(false);
      this.value = this.fn!(this.value);
      this.state = CURRENT;

      Owner = owner;
      Listener = listener;
    }
  }

  dispose() {
    this.fn = null;
    this.log = null;
    this.cleanupComputationNode(true);
  }

  cleanupComputationNode(final: boolean) {
    const source1 = this.source1;
    const sources = this.sources;
    const sourceslots = this.sourceslots;
    const cleanups = this.cleanups;
    const owned = this.owned;
    let i: number;
    let len: number;

    if (cleanups !== null) {
      for (i = 0; i < cleanups.length; i++) {
        cleanups[i](final);
      }
      this.cleanups = null;
    }

    if (owned !== null) {
      for (i = 0; i < owned.length; i++) {
        dispose(owned[i]);
      }
      this.owned = null;
    }

    if (source1 !== null) {
      source1.cleanupSource(this.source1slot);
      this.source1 = null;
    }
    if (sources !== null) {
      // Move Cleanup All Sources
      for (i = 0, len = sources.length; i < len; i++) {
        const source = sources.pop()!;
        source.cleanupSource(sourceslots!.pop()!);
      }
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

  markComputationsStale() {
    const node1 = this.node1;
    const nodes = this.nodes;

    // mark all downstream nodes stale which haven't been already
    if (node1 !== null) node1.markNodeStale();
    if (nodes !== null) {
      for (let i = 0, len = nodes.length; i < len; i++) {
        nodes[i].markNodeStale();
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
let Listener = null as ComputationNode | null; // currently listening computation
let Owner = null as ComputationNode | null; // owner for new computations
let LastNode = null as ComputationNode | null; // cached unused node, for re-use

// Functions

// Use a previously recycled Node or create a new one
// called from makeComputationNode
// called from createRoot
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

function applyDataChange(data: DataNode) {
  data.applyPendingChange();
}

function updateNode(node: ComputationNode) {
  node.updateNode();
}

function dispose(node: ComputationNode) {
  node.dispose();
}
