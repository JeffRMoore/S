/* globals describe, it, expect */

const { createRoot, createSignal, createMemo, sample } = require("../");

describe("sample(...)", function() {
  it("avoids a depdendency", function() {
    createRoot(function() {
      var a = createSignal(1),
        b = createSignal(2),
        c = createSignal(3),
        d = 0,
        e = createMemo(function() {
          d++;
          a();
          sample(b);
          c();
        });

      expect(d).toBe(1);

      b(4);

      expect(d).toBe(1);

      a(5);
      c(6);

      expect(d).toBe(3);
    });
  });
});
