/* globals S, describe, it, expect */

const { createRoot, createSignal, createMemo } = require("../");

describe("createRoot()", function() {
  it("allows subcomputations to escape their parents", function() {
    createRoot(function() {
      var outerTrigger = createSignal(null),
        innerTrigger = createSignal(null),
        outer,
        innerRuns = 0;

      outer = createMemo(function() {
        // register dependency to outer trigger
        outerTrigger();
        // inner computation
        createRoot(function() {
          createMemo(function() {
            // register dependency on inner trigger
            innerTrigger();
            // count total runs
            innerRuns++;
          });
        });
      });

      // at start, we have one inner computation, that's run once
      expect(innerRuns).toBe(1);

      // trigger the outer computation, making more inners
      outerTrigger(null);
      outerTrigger(null);

      expect(innerRuns).toBe(3);

      // now trigger inner signal: three orphaned computations should equal three runs
      innerRuns = 0;
      innerTrigger(null);

      expect(innerRuns).toBe(3);
    });
  });

  //it("is necessary to create a toplevel computation", function () {
  //    expect(() => {
  //        createMemo(() => 1)
  //    }).toThrowError(/root/);
  //});

  it("does not freeze updates when used at top level", function() {
    createRoot(() => {
      var s = createSignal(1),
        c = createMemo(() => s());

      expect(c()).toBe(1);

      s(2);

      expect(c()).toBe(2);

      s(3);

      expect(c()).toBe(3);
    });
  });

  it("persists through entire scope when used at top level", () => {
    createRoot(() => {
      var s = createSignal(1),
        c1 = createMemo(() => s());

      s(2);

      var c2 = createMemo(() => s());

      s(3);

      expect(c2()).toBe(3);
    });
  });
});
