const { createRoot, createSignal, createMemo, freeze } = require("../");

describe("freeze", function() {
  it("batches changes until end", function() {
    var d = createSignal(1);

    freeze(function() {
      d(2);
      expect(d()).toBe(1);
    });

    expect(d()).toBe(2);
  });

  it("halts propagation within its scope", function() {
    createRoot(function() {
      var d = createSignal(1),
        f = createMemo(function() {
          return d();
        });

      freeze(function() {
        d(2);
        expect(f()).toBe(1);
      });

      expect(f()).toBe(2);
    });
  });
});
