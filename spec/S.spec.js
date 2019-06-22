/* global S, describe, it, expect, beforeEach, jasmine */

const { createRoot, createSignal, createMemo } = require("../");

describe("createMemo()", function() {
  describe("creation", function() {
    it("throws if no function passed in", function() {
      createRoot(function() {
        expect(function() {
          createMemo();
        }).toThrow();
      });
    });

    it("throws if arg is not a function", function() {
      createRoot(function() {
        expect(function() {
          createMemo(1);
        }).toThrow();
      });
    });

    it("generates a function", function() {
      createRoot(function() {
        var f = createMemo(function() {
          return 1;
        });
        expect(f).toEqual(jasmine.any(Function));
      });
    });

    it("returns initial value of wrapped function", function() {
      createRoot(function() {
        var f = createMemo(function() {
          return 1;
        });
        expect(f()).toBe(1);
      });
    });
  });

  describe("evaluation", function() {
    it("occurs once intitially", function() {
      createRoot(function() {
        var spy = jasmine.createSpy(),
          f = createMemo(spy);
        expect(spy.calls.count()).toBe(1);
      });
    });

    it("does not re-occur when read", function() {
      createRoot(function() {
        var spy = jasmine.createSpy(),
          f = createMemo(spy);
        f();
        f();
        f();

        expect(spy.calls.count()).toBe(1);
      });
    });
  });

  describe("with a dependency on an createSignal", function() {
    it("updates when createSignal is set", function() {
      createRoot(function() {
        var d = createSignal(1),
          fevals = 0,
          f = createMemo(function() {
            fevals++;
            return d();
          });

        fevals = 0;

        d(1);
        expect(fevals).toBe(1);
      });
    });

    it("does not update when createSignal is read", function() {
      createRoot(function() {
        var d = createSignal(1),
          fevals = 0,
          f = createMemo(function() {
            fevals++;
            return d();
          });

        fevals = 0;

        d();
        expect(fevals).toBe(0);
      });
    });

    it("updates return value", function() {
      createRoot(function() {
        var d = createSignal(1),
          fevals = 0,
          f = createMemo(function() {
            fevals++;
            return d();
          });

        fevals = 0;

        d(2);
        expect(f()).toBe(2);
      });
    });
  });

  describe("with changing dependencies", function() {
    var i, t, e, fevals, f;

    function init() {
      i = createSignal(true);
      t = createSignal(1);
      e = createSignal(2);
      fevals = 0;
      f = createMemo(function() {
        fevals++;
        return i() ? t() : e();
      });
      fevals = 0;
    }

    it("updates on active dependencies", function() {
      createRoot(function() {
        init();
        t(5);
        expect(fevals).toBe(1);
        expect(f()).toBe(5);
      });
    });

    it("does not update on inactive dependencies", function() {
      createRoot(function() {
        init();
        e(5);
        expect(fevals).toBe(0);
        expect(f()).toBe(1);
      });
    });

    it("deactivates obsolete dependencies", function() {
      createRoot(function() {
        init();
        i(false);
        fevals = 0;
        t(5);
        expect(fevals).toBe(0);
      });
    });

    it("activates new dependencies", function() {
      createRoot(function() {
        init();
        i(false);
        fevals = 0;
        e(5);
        expect(fevals).toBe(1);
      });
    });

    it("insures that new dependencies are updated before dependee", function() {
      createRoot(function() {
        var order = "",
          a = createSignal(0),
          b = createMemo(function() {
            order += "b";
            return a() + 1;
          }),
          c = createMemo(function() {
            order += "c";
            return b() || d();
          }),
          d = createMemo(function() {
            order += "d";
            return a() + 10;
          });

        expect(order).toBe("bcd");

        order = "";
        a(-1);

        expect(order).toBe("bcd");
        expect(c()).toBe(9);

        order = "";
        a(0);

        expect(order).toBe("bcd");
        expect(c()).toBe(1);
      });
    });
  });

  describe("that creates an createSignal", function() {
    it("does not register a dependency", function() {
      createRoot(function() {
        var fevals = 0,
          f = createMemo(function() {
            fevals++;
            d = createSignal(1);
          });
        fevals = 0;
        d(2);
        expect(fevals).toBe(0);
      });
    });
  });

  describe("from a function with no return value", function() {
    it("reads as undefined", function() {
      createRoot(function() {
        var f = createMemo(function() {});
        expect(f()).not.toBeDefined();
      });
    });
  });

  describe("with a seed", function() {
    it("reduces seed value", function() {
      createRoot(function() {
        var a = createSignal(5),
          f = createMemo(function(v) {
            return v + a();
          }, 5);
        expect(f()).toBe(10);
        a(6);
        expect(f()).toBe(16);
      });
    });
  });

  describe("with a dependency on a computation", function() {
    var d, fcount, f, gcount, g;

    function init() {
      (d = createSignal(1)),
        (fcount = 0),
        (f = createMemo(function() {
          fcount++;
          return d();
        })),
        (gcount = 0),
        (g = createMemo(function() {
          gcount++;
          return f();
        }));
    }

    it("does not cause re-evaluation", function() {
      createRoot(function() {
        init();
        expect(fcount).toBe(1);
      });
    });

    it("does not occur from a read", function() {
      createRoot(function() {
        init();
        f();
        expect(gcount).toBe(1);
      });
    });

    it("does not occur from a read of the watcher", function() {
      createRoot(function() {
        init();
        g();
        expect(gcount).toBe(1);
      });
    });

    it("occurs when computation updates", function() {
      createRoot(function() {
        init();
        d(2);
        expect(fcount).toBe(2);
        expect(gcount).toBe(2);
        expect(g()).toBe(2);
      });
    });
  });

  describe("with unending changes", function() {
    it("throws when continually setting a direct dependency", function() {
      createRoot(function() {
        var d = createSignal(1);

        expect(function() {
          createMemo(function() {
            d();
            d(2);
          });
        }).toThrow();
      });
    });

    it("throws when continually setting an indirect dependency", function() {
      createRoot(function() {
        var d = createSignal(1),
          f1 = createMemo(function() {
            return d();
          }),
          f2 = createMemo(function() {
            return f1();
          }),
          f3 = createMemo(function() {
            return f2();
          });

        expect(function() {
          createMemo(function() {
            f3();
            d(2);
          });
        }).toThrow();
      });
    });
  });

  describe("with circular dependencies", function() {
    it("throws when cycle created by modifying a branch", function() {
      createRoot(function() {
        var d = createSignal(1),
          f = createMemo(function() {
            return f ? f() : d();
          });

        expect(function() {
          d(0);
        }).toThrow();
      });
    });
  });

  describe("with converging dependencies", function() {
    it("propagates in topological order", function() {
      createRoot(function() {
        //
        //     c1
        //    /  \
        //   /    \
        //  b1     b2
        //   \    /
        //    \  /
        //     a1
        //
        var seq = "",
          a1 = createSignal(true),
          b1 = createMemo(function() {
            a1();
            seq += "b1";
          }),
          b2 = createMemo(function() {
            a1();
            seq += "b2";
          }),
          c1 = createMemo(function() {
            b1(), b2();
            seq += "c1";
          });

        seq = "";
        a1(true);

        expect(seq).toBe("b1b2c1");
      });
    });

    it("only propagates once with linear convergences", function() {
      createRoot(function() {
        //         d
        //         |
        // +---+---+---+---+
        // v   v   v   v   v
        // f1  f2  f3  f4  f5
        // |   |   |   |   |
        // +---+---+---+---+
        //         v
        //         g
        var d = createSignal(0),
          f1 = createMemo(function() {
            return d();
          }),
          f2 = createMemo(function() {
            return d();
          }),
          f3 = createMemo(function() {
            return d();
          }),
          f4 = createMemo(function() {
            return d();
          }),
          f5 = createMemo(function() {
            return d();
          }),
          gcount = 0,
          g = createMemo(function() {
            gcount++;
            return f1() + f2() + f3() + f4() + f5();
          });

        gcount = 0;
        d(0);
        expect(gcount).toBe(1);
      });
    });

    it("only propagates once with exponential convergence", function() {
      createRoot(function() {
        //     d
        //     |
        // +---+---+
        // v   v   v
        // f1  f2 f3
        //   \ | /
        //     O
        //   / | \
        // v   v   v
        // g1  g2  g3
        // +---+---+
        //     v
        //     h
        var d = createSignal(0),
          f1 = createMemo(function() {
            return d();
          }),
          f2 = createMemo(function() {
            return d();
          }),
          f3 = createMemo(function() {
            return d();
          }),
          g1 = createMemo(function() {
            return f1() + f2() + f3();
          }),
          g2 = createMemo(function() {
            return f1() + f2() + f3();
          }),
          g3 = createMemo(function() {
            return f1() + f2() + f3();
          }),
          hcount = 0,
          h = createMemo(function() {
            hcount++;
            return g1() + g2() + g3();
          });

        hcount = 0;
        d(0);
        expect(hcount).toBe(1);
      });
    });
  });
});
