const { createRoot, createSignal, createMemo } = require("../");

describe("createRoot(dispose)", function() {
  it("disables updates and sets computation's value to undefined", function() {
    createRoot(function(dispose) {
      var c = 0,
        d = createSignal(0),
        f = createMemo(function() {
          c++;
          return d();
        });

      expect(c).toBe(1);
      expect(f()).toBe(0);

      d(1);

      expect(c).toBe(2);
      expect(f()).toBe(1);

      dispose();

      d(2);

      expect(c).toBe(2);
      expect(f()).toBe(1);
    });
  });

  // unconventional uses of dispose -- to insure S doesn't behaves as expected in these cases

  it("works from the body of its own computation", function() {
    createRoot(function(dispose) {
      var c = 0,
        d = createSignal(0),
        f = createMemo(function() {
          c++;
          if (d()) dispose();
          d();
        });

      expect(c).toBe(1);

      d(1);

      expect(c).toBe(2);

      d(2);

      expect(c).toBe(2);
    });
  });

  it("works from the body of a subcomputation", function() {
    createRoot(function(dispose) {
      var c = 0,
        d = createSignal(0),
        f = createMemo(function() {
          c++;
          d();
          createMemo(function() {
            if (d()) dispose();
          });
        });

      expect(c).toBe(1);

      d(1);

      expect(c).toBe(2);

      d(2);

      expect(c).toBe(2);
    });
  });
});
