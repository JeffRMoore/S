﻿// sets, unordered and ordered, in XO

// seq -> seq
// 1st: map, order, filter
// 2nd: each, group, reverse, append
// 3rd: orderDesc

// seq -> val
// 1st: find, all, any, contains, reduce, reduceRight, max, min

(function (X) {
    "use strict";

    X.seq = seq;

    // cmd codes
    var ENTER = 0,
        EXIT = 1,
        MOVE = 2;

    return;

    function seq(values) {
        var len = values.length,
            deltas = {},
            changed = X.ch(deltas),
            seq = X.proc(function () { changed(); return values; }, update);

        add_seq_methods(seq, values, deltas, changed);

        seq.add = add;
        seq.remove = remove;

        return seq;

        function update(new_values) {
            var i;

            deltas = deltas.next = { cmd: SPLICE, i: 0, len: len, items: values };
            len = values.length = update.length;
            for (i = 0; i < len; i++) {
                values[i] = update[i];
            }

            changed(values);
        }

        function add(item) {
            values.push(item);
            len = values.length;
            deltas = deltas.next = { cmd: SPLICE, i: len - 1, len: 0, items: [ item ] };
            changed(values);
            return seq;
        }

        function remove(item) {
            for (var i = 0; i < len; i++) {
                if (values[i] === item) {
                    values.splice(i, 1);
                    len = values.length;
                    deltas = deltas.next = { cmd: SPLICE, i: i, len: 1, items: [] };
                    changed(values);
                    return seq;
                }
            }
            return seq;
        }

        function _map(enter, exit, move) {
            return map(values, deltas, changed, enter, exit, move);
        }

        function toArray() {
            return changed();
        }
    }

    function map(invalues, indeltas, inchanged, enter, exit, move) {
        var values = invalues.map(enter),
            len = values.length,
            deltas = {},
            changed = X.ch(values),
            cmds = [ cmd_enter, cmd_exit, cmd_move ],
            updater = X(function () {
                inchanged();
                while (indeltas.next) {
                    indeltas = indeltas.next;
                    cmds[indeltas.cmd]();
                }
            }),
            map = {
                map: _map,
                toArray: toArray,
                "in": updater.in
            };

        return map;

        function cmd_enter() {
            var i = indeltas.i,
                item = enter ? enter(indeltas.item, i) : indeltas.item;

            values[i] = item;
            len = values.length;

            deltas = deltas.next = { cmd: ENTER, i: i, item: item };

            changed(values);
        }

        function cmd_exit() {
            var i = indeltas.i,
                item = values[i];

            if (exit) exit(item, i);

            deltas = deltas.next = { cmd: EXIT, i: i };

            changed(values);
        }

        function cmd_move() {
            var moves = indeltas.moves,
                copy = [],
                i;

            for (var i in moves) {
                copy[i] = values[i];
            }

            for (var i in moves) {
                values[moves[i]] = copy[i];
            }

            if (move) move(copy, moves);

            deltas = deltas.next = { cmd: MOVE, moves: moves };

            changed(values);
        }
    }

    function add_seq_methods(seq, values, deltas, changed) {

        seq.map = seq_map;

        function seq_map(enter, exit, move) {
            return map(values, deltas, changed, enter, exit, move);
        }
    }
})(X);