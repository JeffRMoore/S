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

  // TODO: investigate copying createMemo and inlining it here to allow refactoring
  return createMemo(on, seed);

  // TODO: Ruturn type no specified (ANY)
  function on(value?: T) {
    // TODO: I'm not convinced this is capturing the listener at the right point.
    // TODO: Should we capture inside the closure?  is createMemo going to do
    // TODO: Something weird with the listener?
    const prevListener = Listener;

    forceDependencies();
    if (waiting) {
      waiting = false;
    } else {
      Listener = null; // TODO: Maybe we should stop listening before forcing dependencies?
      value = fn(value);
      Listener = prevListener;
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

  // stop listening
  const prevListener = Listener;
  Listener = null;

  result = fn();

  Listener = prevListener;

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

  // isRunning management is hard to follow; doesn't have logic to it
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
    let result: T;

    const prevOwner = Owner;
    Owner = UNOWNED;

    try {
      result = (fn as any)();
    } finally {
      Owner = prevOwner;
    }

    return result;
  }

  // called from createRoot
  runRoot<T>(fn: DisposalFn<T>): T {
    let result: T;
    let clock = this;

    let rootComputation = getCandidateNode();

    const prevOwner = Owner;
    Owner = rootComputation;

    try {
      result = fn(function _dispose() {
        if (rootComputation === null) {
          // nothing to dispose
        } else if (clock.isRunning) {
          clock.disposes.add(rootComputation);
        } else {
          dispose(rootComputation);
        }
      });
    } finally {
      Owner = prevOwner;
    }

    if (rootComputation.recycleNode(null as any, undefined)) {
      rootComputation = null!;
    } else {
      rootComputation.claimComputationNode(null as any, undefined);
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
      this.isRunning = false;
    }
  }

  // called from createEffect
  // called from createMemo
  // we should just call this on state transition to "stopped"
  finishToplevelComputation() {
    if (this.changes.count > 0 || this.updates.count > 0) {
      this.time++;
      try {
        this.run();
      } finally {
        this.isRunning = false;
      }
    }
  }

  // called from createEffect
  createEffect<T>(fn: ComputationFn<T>, value: T | undefined): void {
    const effectComputation = getCandidateNode();

    const prevListener = Listener;
    Listener = effectComputation;

    const prevOwner = Owner;
    Owner = effectComputation;

    if (!this.isRunning) {
      value = this.execToplevelComputation(fn, value);
    } else {
      value = fn(value);
    }

    Owner = prevOwner;
    Listener = prevListener;

    effectComputation.recycleOrClaimNode(fn, value);

    if (!this.isRunning) this.finishToplevelComputation();
  }

  // called from createMemo
  createMemo<T>(
    fn: ComputationFn<T>,
    value: T | undefined
  ): ReadableDataSignal<T> {
    const memoComputation = getCandidateNode();

    const prevListener = Listener;
    Listener = memoComputation;

    if (Owner === null) {
      console.warn(
        "computations created without a root or parent will never be disposed"
      );
    }
    const prevOwner = Owner;
    Owner = memoComputation;

    if (!this.isRunning) {
      value = RootClock.execToplevelComputation(fn, value);
    } else {
      value = fn(value);
    }

    Owner = prevOwner;
    Listener = prevListener;

    const recycled = memoComputation.recycleOrClaimNode(fn, value);

    if (!this.isRunning) RootClock.finishToplevelComputation();

    let _node = recycled ? null : memoComputation;
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
    const prevOwner = Owner;
    // TODO: Why is it safe to ignore pending updates?
    this.updates.reset();
    this.time++;
    try {
      this.run();
    } finally {
      Owner = prevOwner;
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
      const prevListener = Listener;
      Listener = this;

      const prevOwner = Owner;
      Owner = this;

      this.state = RUNNING;
      this.cleanupComputationNode(false);
      this.value = this.fn!(this.value);
      this.state = CURRENT;

      Owner = prevOwner;
      Listener = prevListener;
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

  claimComputationNode<T>(fn: ComputationFn<T>, value: T): void {
    const newOwner = Owner === UNOWNED ? null : Owner;
    this.fn = fn;
    this.value = value;
    this.age = RootClock.time;

    if (newOwner !== null) {
      if (newOwner.owned === null) newOwner.owned = [this];
      else newOwner.owned.push(this);
    }
  }

  recycleNode<T>(fn: ComputationFn<T>, value: T): boolean {
    // We cannot recycle nodes that have sources
    if (this.source1 !== null) {
      return false;
    }
    const newOwner = Owner === UNOWNED ? null : Owner;
    if (newOwner === null) {
      // If we have no Owner to transfer owned items or cleanups to, we cannot recycle
      if (this.owned !== null || this.cleanups !== null) {
        return false;
      }
    } else {
      // transfer any owned items to new owner
      if (this.owned !== null) {
        if (newOwner.owned === null) {
          newOwner.owned = this.owned;
        } else {
          for (let i = 0; i < this.owned.length; i++) {
            newOwner.owned.push(this.owned[i]);
          }
        }
        this.owned = null;
      }

      // transfer any cleanups to new owner
      if (this.cleanups !== null) {
        if (newOwner.cleanups === null) {
          newOwner.cleanups = this.cleanups;
        } else {
          for (let i = 0; i < this.cleanups.length; i++) {
            newOwner.cleanups.push(this.cleanups[i]);
          }
        }
        this.cleanups = null;
      }
    }
    LastNode = this;
    return true;
  }

  recycleOrClaimNode<T>(fn: ComputationFn<T>, value: T): boolean {
    const recycled = this.recycleNode(fn, value);
    if (!recycled) {
      this.claimComputationNode(fn, value);
    }
    return recycled;
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
let Owner = null as ComputationNode | null; // owner for new computations
let LastNode = null as ComputationNode | null; // cached unused node, for re-use

/**
 * Record the currently listening computation as a global or null if there is no
 * current listener
 */
type ListenerSpec = ComputationNode | null;
let Listener = null as ListenerSpec;

// Use a previously recycled Node or create a new one
// called from makeComputationNode
// called from createRoot
function getCandidateNode() {
  let node = LastNode;
  if (node === null) node = new ComputationNode();
  else LastNode = null;
  return node;
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
