const { createRoot, createSignal, createMemo } = require("../");

describe("createMemo() with subcomputations", function() {
  it("does not register a dependency on the subcomputation", function() {
    createRoot(function() {
      var d = createSignal(1),
        spy = jasmine.createSpy("spy"),
        gspy = jasmine.createSpy("gspy"),
        f = createMemo(function() {
          spy();
          var g = createMemo(function() {
            gspy();
            return d();
          });
        });

      spy.calls.reset();
      gspy.calls.reset();

      d(2);

      expect(gspy.calls.count()).toBe(1);
      expect(spy.calls.count()).toBe(0);
    });
  });

  describe("with child", function() {
    var d, e, fspy, f, gspy, g, h;

    function init() {
      d = createSignal(1);
      e = createSignal(2);
      fspy = jasmine.createSpy("fspy");
      gspy = jasmine.createSpy("gspy");
      f = createMemo(function() {
        fspy();
        d();
        g = createMemo(function() {
          gspy();
          return e();
        });
      });
      h = g;
      h();
    }

    it("creates child on initialization", function() {
      createRoot(function() {
        init();
        expect(h).toEqual(jasmine.any(Function));
        expect(h()).toBe(2);
      });
    });

    it("does not depend on child's dependencies", function() {
      createRoot(function() {
        init();
        e(3);
        expect(fspy.calls.count()).toBe(1);
        expect(gspy.calls.count()).toBe(2);
      });
    });

    it("disposes old child when updated", function() {
      createRoot(function() {
        init();
        // re-evalue parent, thereby disposing stale g, which we've stored at h
        d(2);
        e(3);
        // h is now disposed
        expect(h()).toBe(2);
      });
    });

    it("disposes child when it is disposed", function() {
      const dispose = createRoot(function(dispose) {
        init();
        return dispose;
      });

      dispose();
      e(3);
      expect(g()).toBe(2);
    });
  });

  describe("which disposes sub that's being updated", function() {
    it("propagates successfully", function() {
      createRoot(function() {
        var a = createSignal(1),
          b = createMemo(function() {
            var c = createMemo(function() {
              return a();
            });
            a();
            return { c: c };
          }),
          d = createMemo(function() {
            return b().c();
          });

        expect(d()).toBe(1);
        a(2);
        expect(d()).toBe(2);
        a(3);
        expect(d()).toBe(3);
      });
    });
  });

  describe("which disposes a sub with a dependee with a sub", function() {
    it("propagates successfully", function() {
      createRoot(function() {
        var a = createSignal(1),
          c,
          b = createMemo(function() {
            c = createMemo(function() {
              return a();
            });
            a();
            return { c: c };
          }),
          d = createMemo(function() {
            c();
            var e = createMemo(function() {
              return a();
            });
            return { e: e };
          });

        expect(d().e()).toBe(1);
        a(2);
        expect(d().e()).toBe(2);
        a(3);
        expect(d().e()).toBe(3);
      });
    });
  });
});
