const { createRoot, createSignal, createDependentEffect } = require("../");

/* globals jasmine */
describe("createDependentEffect(...)", function() {
  it("registers a dependency", function() {
    createRoot(function() {
      var d = createSignal(1),
        spy = jasmine.createSpy(),
        f = createDependentEffect(d, function() {
          spy();
        });

      expect(spy.calls.count()).toBe(1);

      d(2);

      expect(spy.calls.count()).toBe(2);
    });
  });

  it("prohibits dynamic dependencies", function() {
    createRoot(function() {
      var d = createSignal(1),
        spy = jasmine.createSpy("spy"),
        s = createDependentEffect(
          function() {},
          function() {
            spy();
            return d();
          }
        );

      expect(spy.calls.count()).toBe(1);

      d(2);

      expect(spy.calls.count()).toBe(1);
    });
  });

  it("allows multiple dependencies", function() {
    createRoot(function() {
      var a = createSignal(1),
        b = createSignal(2),
        c = createSignal(3),
        spy = jasmine.createSpy(),
        f = createDependentEffect(
          function() {
            a();
            b();
            c();
          },
          function() {
            spy();
          }
        );

      expect(spy.calls.count()).toBe(1);

      a(4);
      b(5);
      c(6);

      expect(spy.calls.count()).toBe(4);
    });
  });

  it("allows an array of dependencies", function() {
    createRoot(function() {
      var a = createSignal(1),
        b = createSignal(2),
        c = createSignal(3),
        spy = jasmine.createSpy(),
        f = createDependentEffect([a, b, c], function() {
          spy();
        });

      expect(spy.calls.count()).toBe(1);

      a(4);
      b(5);
      c(6);

      expect(spy.calls.count()).toBe(4);
    });
  });

  it("modifies its accumulator when reducing", function() {
    createRoot(function() {
      var a = createSignal(1),
        c = createDependentEffect(
          a,
          function(sum) {
            return sum + a();
          },
          0
        );

      expect(c()).toBe(1);

      a(2);

      expect(c()).toBe(3);

      a(3);
      a(4);

      expect(c()).toBe(10);
    });
  });

  it("suppresses initial run when onchanges is true", function() {
    createRoot(function() {
      var a = createSignal(1),
        c = createDependentEffect(
          a,
          function() {
            return a() * 2;
          },
          0,
          true
        );

      expect(c()).toBe(0);

      a(2);

      expect(c()).toBe(4);
    });
  });
});
