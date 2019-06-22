const { createRoot, createSignal, createMemo } = require("../");

describe("Computations which modify data", function() {
  it("freeze data while executing computation", function() {
    createRoot(function() {
      var a = createSignal(false),
        b = createSignal(0),
        cb,
        c = createMemo(function() {
          if (a()) {
            b(1);
            cb = b();
            a(false);
          }
        });

      b(0);
      a(true);

      expect(b()).toBe(1);
      expect(cb).toBe(0);
    });
  });

  it("freeze data while propagating", function() {
    createRoot(function() {
      var seq = "",
        a = createSignal(false),
        b = createSignal(0),
        db,
        c = createMemo(function() {
          if (a()) {
            seq += "c";
            b(1);
            a(false);
          }
        }),
        d = createMemo(function() {
          if (a()) {
            seq += "d";
            db = b();
          }
        });

      b(0);
      seq = "";
      a(true);

      expect(seq).toBe("cd");
      expect(b()).toBe(1);
      expect(db).toBe(0); // d saw b(0) even though it ran after c whcih modified b() to b(1)
    });
  });

  it("continue running until changes stop", function() {
    createRoot(function() {
      var seq = "",
        a = createSignal(0);

      createMemo(function() {
        seq += a();
        if (a() < 10) a(a() + 1);
      });

      expect(seq).toBe("012345678910");
      expect(a()).toBe(10);
    });
  });

  it("propagate changes topologically", function() {
    createRoot(function() {
      //
      //    d1      d2
      //    |  \  /  |
      //    |   c1   |
      //    |   ^    |
      //    |   :    |
      //    b1  b2  b3
      //      \ | /
      //        a1
      //
      var seq = "",
        a1 = createSignal(0),
        c1 = createSignal(0),
        b1 = createMemo(function() {
          a1();
        }),
        b2 = createMemo(function() {
          c1(a1());
        }),
        b3 = createMemo(function() {
          a1();
        }),
        d1 = createMemo(function() {
          b1();
          seq += "c4(" + c1() + ")";
        }),
        d2 = createMemo(function() {
          b3();
          seq += "c5(" + c1() + ")";
        });

      seq = "";
      a1(1);

      expect(seq).toBe("c4(0)c5(0)c4(1)c5(1)");
    });
  });
});
