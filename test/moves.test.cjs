'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SortStore, parentOf, nameOf } = require('../core.cjs');
const { MoveController } = require('../moves.cjs');

function fixture(settings = {}) {
  const entries = new Map(), store = new SortStore(settings), calls = [];
  const add = (path, folder = false) => {
    const parent = path === '/' ? null : entries.get(parentOf(path));
    const file = { path, name: nameOf(path), parent, ...(folder ? { children: [] } : {}) };
    entries.set(path, file); parent?.children.push(file); return file;
  };
  for (const path of ['/', 'P', 'P/Sub', 'P/Sub/Deep', 'Q']) add(path, true);
  for (const path of ['P/a.md', 'P/b.md', 'P/Sub/x.md', 'P/Sub/y.md', 'P/Sub/Deep/n.md', 'Q/one.md', 'Q/two.md']) add(path);
  const host = {
    getStore: () => store, resolve: path => entries.get(path),
    sorted: (_view, path) => store.apply(path, entries.get(path).children.slice()
      .sort((a, b) => a.name.localeCompare(b.name)).map(file => ({ file })), true).map(item => item.file.name),
    rename: async (file, next) => {
      calls.push([file.path, next]);
      if (host.fail?.(file, next)) throw Error('Simulated rename failure');
      assert.equal(entries.has(next), false, 'must never overwrite a target');
      const old = file.path;
      file.parent.children = file.parent.children.filter(child => child !== file);
      const descendants = [...entries].filter(([path]) => path === old || path.startsWith(old + '/'));
      for (const [path] of descendants) entries.delete(path);
      for (const [path, child] of descendants) {
        child.path = next + path.slice(old.length); child.name = nameOf(child.path); entries.set(child.path, child);
      }
      file.parent = entries.get(parentOf(next)); file.parent.children.push(file);
      store.rename(old, next);
      if (host.failAfter?.(file, next)) throw Error('Failure after the rename completed');
    },
    commit: async () => true,
  };
  return { entries, store, calls, add, host, moves: new MoveController(host) };
}
const before = path => ({ kind: 'insert', path, after: false });

test('moves a child to an exact position in its parent and undo restores paths/order', async () => {
  const f = fixture({ orders: { P: ['a.md', 'Sub', 'b.md'], 'P/Sub': ['x.md', 'y.md', 'Deep'] } });
  await f.moves.drop(null, ['P/Sub/x.md'], before('P/Sub'));
  assert.deepEqual(f.store.data.orders.P, ['a.md', 'x.md', 'Sub', 'b.md']);
  assert.ok(f.entries.has('P/x.md')); assert.equal(f.entries.has('P/Sub/x.md'), false);
  await f.moves.undo(null, f.moves.lastMove);
  assert.ok(f.entries.has('P/Sub/x.md'));
  assert.deepEqual(f.store.data.orders.P, ['a.md', 'Sub', 'b.md']);
  assert.deepEqual(f.store.data.orders['P/Sub'], ['x.md', 'y.md', 'Deep']);
});
test('inserts into another folder at an anchor, then undo removes newly created target order', async () => {
  const f = fixture();
  await f.moves.drop(null, ['P/Sub/x.md'], { kind: 'insert', path: 'Q/one.md', after: true });
  assert.deepEqual(f.store.data.orders.Q, ['one.md', 'x.md', 'two.md']);
  await f.moves.undo(null, f.moves.lastMove);
  assert.equal(f.store.data.orders.Q, undefined); assert.equal(f.store.data.orders['P/Sub'], undefined);
});
test('moving a folder preserves nested sorting and pin/hide flags through undo', async () => {
  const f = fixture({ orders: { 'P/Sub': ['y.md', 'x.md', 'Deep'], 'P/Sub/Deep': ['n.md'] },
    pinned: ['P/Sub/x.md'], hidden: ['P/Sub/Deep'] });
  await f.moves.drop(null, ['P/Sub'], { kind: 'inside', path: 'Q' });
  assert.deepEqual(f.store.data.orders['Q/Sub'], ['y.md', 'x.md', 'Deep']);
  assert.deepEqual(f.store.data.pinned, ['Q/Sub/x.md']);
  assert.deepEqual(f.store.data.hidden, ['Q/Sub/Deep']);
  await f.moves.undo(null, f.moves.lastMove);
  assert.deepEqual(f.store.data.orders['P/Sub/Deep'], ['n.md']);
  assert.deepEqual(f.store.data.pinned, ['P/Sub/x.md']);
});
test('rejects same-name collisions before any file is moved', async () => {
  const f = fixture(); f.add('Q/x.md');
  await assert.rejects(f.moves.drop(null, ['P/Sub/x.md'], before('Q/one.md')), /already exists/);
  assert.deepEqual(f.calls, []); assert.ok(f.entries.has('P/Sub/x.md'));
});
test('rejects moving a folder inside its descendant', async () => {
  const f = fixture();
  await assert.rejects(f.moves.drop(null, ['P/Sub'], before('P/Sub/Deep/n.md')), /descendant/);
  assert.deepEqual(f.calls, []);
});
test('cross-folder selections retain their source display order', async () => {
  const f = fixture({ orders: { 'P/Sub': ['y.md', 'x.md', 'Deep'] } });
  await f.moves.drop(null, ['P/Sub/x.md', 'P/Sub/y.md'], before('Q/two.md'));
  assert.deepEqual(f.store.data.orders.Q, ['one.md', 'y.md', 'x.md', 'two.md']);
});
test('a failed multi-item move rolls back completed renames and source positions', async () => {
  const f = fixture({ orders: { 'P/Sub': ['x.md', 'y.md', 'Deep'] } });
  f.host.fail = (_file, path) => path === 'Q/y.md';
  await assert.rejects(f.moves.drop(null, ['P/Sub/x.md', 'P/Sub/y.md'], before('Q/two.md')), /rolled back/);
  assert.ok(f.entries.has('P/Sub/x.md')); assert.ok(f.entries.has('P/Sub/y.md'));
  assert.deepEqual(f.store.data.orders['P/Sub'], ['x.md', 'y.md', 'Deep']);
  assert.equal(f.store.data.orders.Q, undefined); assert.equal(f.moves.busy, false);
});
test('undo refuses occupied original paths without modifying any file', async () => {
  const f = fixture();
  await f.moves.drop(null, ['P/Sub/x.md'], before('Q/one.md'));
  f.add('P/Sub/x.md'); const count = f.calls.length;
  await assert.rejects(f.moves.undo(null, f.moves.lastMove), /occupied/);
  assert.equal(f.calls.length, count); assert.ok(f.entries.has('Q/x.md'));
});
test('undo preserves later manual edits in the destination', async () => {
  const f = fixture();
  await f.moves.drop(null, ['P/Sub/x.md'], before('Q/two.md'));
  f.store.data.orders.Q = ['two.md', 'x.md', 'one.md'];
  await f.moves.undo(null, f.moves.lastMove);
  assert.deepEqual(f.store.data.orders.Q, ['two.md', 'one.md']);
});
test('same-folder insertion changes only order and never calls the rename API', async () => {
  const f = fixture();
  await f.moves.drop(null, ['Q/two.md'], before('Q/one.md'));
  assert.deepEqual(f.store.data.orders.Q, ['two.md', 'one.md']); assert.deepEqual(f.calls, []);
});
test('case-insensitive name collisions are rejected before touching files', async () => {
  const f = fixture(); f.add('Q/X.md');
  await assert.rejects(f.moves.drop(null, ['P/Sub/x.md'], before('Q/one.md')), /already exists/);
  assert.deepEqual(f.calls, []);
});
test('a rename that fails after changing the path is still rolled back', async () => {
  const f = fixture({ orders: { 'P/Sub': ['x.md', 'y.md', 'Deep'] } });
  f.host.failAfter = (_file, path) => path === 'Q/x.md';
  await assert.rejects(f.moves.drop(null, ['P/Sub/x.md'], before('Q/one.md')), /rolled back/);
  assert.ok(f.entries.has('P/Sub/x.md')); assert.equal(f.entries.has('Q/x.md'), false);
  assert.deepEqual(f.store.data.orders['P/Sub'], ['x.md', 'y.md', 'Deep']);
});
test('undo preserves later ordering changes in the source', async () => {
  const f = fixture({ orders: { 'P/Sub': ['x.md', 'y.md', 'Deep'] } });
  await f.moves.drop(null, ['P/Sub/x.md'], before('Q/one.md'));
  f.store.data.orders['P/Sub'] = ['Deep', 'y.md'];
  await f.moves.undo(null, f.moves.lastMove);
  assert.deepEqual(f.store.data.orders['P/Sub'], ['Deep', 'x.md', 'y.md']);
});
