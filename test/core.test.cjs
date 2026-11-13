'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SortStore, SaveQueue, compileGlob } = require('../core.cjs');
const items = (parent, names) => names.map(name => ({ file: { name, path: parent === '/' ? name : `${parent}/${name}` } }));
const names = items => items.map(item => item.file.name);

test('untouched folders return native results unchanged, including folder grouping and ties', () => {
  const s = new SortStore(); const input = items('/', ['Folder', 'z.md', 'a.md']);
  assert.equal(s.apply('/', input), input);
  assert.equal(Object.keys(s.data.orders).length, 0);
});
test('manual order is stable; new children use native tail order without getting recorded', () => {
  const s = new SortStore({ orders: { P: ['z.md', 'Folder', 'deleted.md'] } });
  const input = items('P', ['Folder', 'a.md', 'new.md', 'z.md']);
  assert.deepEqual(names(s.apply('P', input)), ['z.md', 'Folder', 'a.md', 'new.md']);
  assert.deepEqual(names(input), ['Folder', 'a.md', 'new.md', 'z.md']);
  assert.deepEqual(s.data.orders.P, ['z.md', 'Folder', 'deleted.md']);
});
test('first real drag captures just its parent; no-op and canceled targets create no records', () => {
  const s = new SortStore();
  assert.equal(s.reorder('P', ['a', 'b', 'c'], ['b'], 'c', false), false);
  assert.equal(s.reorder('P', ['a', 'b', 'c'], ['b'], 'b', true), false);
  assert.equal(s.reorder('P', ['a', 'b', 'c'], ['c'], 'a', false), true);
  assert.deepEqual(s.data.orders.P, ['c', 'a', 'b']);
  assert.deepEqual(Object.keys(s.data.orders), ['P']);
  s.reset('P'); assert.equal(Object.keys(s.data.orders).length, 0);
});
test('multi-item reorder preserves displayed block order and rejects stale selection', () => {
  const s = new SortStore();
  s.reorder('P', ['a', 'b', 'c', 'd', 'e'], ['d', 'b'], 'e', true);
  assert.deepEqual(s.data.orders.P, ['a', 'c', 'e', 'b', 'd']);
  assert.equal(s.reorder('P', ['a', 'b'], ['gone'], 'a', true), false);
});
test('pins are stable and cannot be dragged across pin boundary', () => {
  const s = new SortStore({ pinned: ['P/c'], orders: { P: ['b', 'a', 'c'] } });
  assert.deepEqual(names(s.apply('P', items('P', ['a', 'b', 'c']))), ['c', 'b', 'a']);
  assert.equal(s.reorder('P', ['c', 'b', 'a'], ['a'], 'c', false), false);
});
test('hidden ancestors and patterns hide whole subtrees; includeHidden preserves snapshot', () => {
  const s = new SortStore({ hidden: ['P/private'], hidePatterns: ['*.tmp', '/assets/**'] });
  assert.equal(s.isHidden('P/private/deep/note.md'), true);
  assert.equal(s.isHidden('P/private-other/note.md'), false);
  assert.equal(s.isHidden('assets/2026/a.png'), true);
  assert.equal(s.isHidden('P/test.tmp'), true);
  const input = items('P', ['a', 'private', 'test.tmp']);
  assert.deepEqual(names(s.apply('P', input)), ['a']);
  assert.equal(s.apply('P', input, true), input);
  s.data.showHidden = true; assert.equal(s.apply('P', input), input);
  assert.equal(compileGlob('**/x?.md').test('x1.md'), true);
  assert.equal(compileGlob('a[1].md').test('a[1].md'), true);
});
test('folder rename rebases only saved descendants, own parent position, pins and hidden flags', () => {
  const s = new SortStore({ orders: { '/': ['P', 'Q'], P: ['x'], 'P/deep': ['n'], 'Prefix': ['p'] },
    pinned: ['P/x'], hidden: ['P/deep'] });
  assert.equal(s.rename('P', 'Renamed'), true);
  assert.deepEqual(s.data.orders['/'], ['Renamed', 'Q']);
  assert.deepEqual(s.data.orders.Renamed, ['x']);
  assert.deepEqual(s.data.orders['Renamed/deep'], ['n']);
  assert.deepEqual(s.data.orders.Prefix, ['p']);
  assert.deepEqual(s.data.pinned, ['Renamed/x']); assert.deepEqual(s.data.hidden, ['Renamed/deep']);
});
test('cross-folder move removes old position without enrolling destination; delete removes subtree', () => {
  const s = new SortStore({ orders: { P: ['x', 'a'], 'P/x': ['y'], 'P/xyz': ['z'] }, hidden: ['P/x/y'] });
  assert.equal(s.rename('P/x', 'Q/x'), true);
  assert.deepEqual(s.data.orders.P, ['a']); assert.equal(s.data.orders.Q, undefined);
  assert.deepEqual(s.data.orders['Q/x'], ['y']);
  assert.equal(s.remove('Q/x'), true); assert.equal(s.data.orders['Q/x'], undefined);
  assert.deepEqual(s.data.hidden, []); assert.deepEqual(s.data.orders['P/xyz'], ['z']);
  assert.equal(s.rename('untracked', 'elsewhere'), false);
  assert.equal(s.remove('untracked'), false);
});
test('legacy import is opt-in per directory and copies real flags without file metadata', () => {
  const s = new SortStore();
  s.importLegacy({ items: { '/': { customOrder: ['P', 'deleted'] }, P: { customOrder: ['n'] },
    'P/n': { isPinned: true, ctime: 5 }, assets: { isHidden: true } } }, ['/'], path => path !== 'deleted');
  assert.deepEqual(s.data.orders['/'], ['P']); assert.equal(s.data.orders.P, undefined);
  assert.deepEqual(s.data.pinned, ['P/n']); assert.deepEqual(s.data.hidden, ['assets']);
  assert.equal(JSON.stringify(s.data).includes('ctime'), false);
});
test('path keys such as __proto__ are safe; future schema is rejected', () => {
  const s = new SortStore(JSON.parse('{"orders":{"__proto__":["a"]}}'));
  assert.deepEqual(s.data.orders.__proto__, ['a']);
  assert.throws(() => new SortStore({ version: 2 }));
});
test('save queue collapses a burst, snapshots immutably and serializes writes', async () => {
  let release; const writes = []; let inFlight = 0;
  const q = new SaveQueue(async data => {
    assert.equal(++inFlight, 1); writes.push(data.n);
    if (writes.length === 1) await new Promise(resolve => { release = resolve; });
    inFlight--;
  });
  const data = { n: 1 }; const done = q.enqueue(data); data.n = 10;
  await Promise.resolve();
  q.enqueue({ n: 2 }); q.enqueue({ n: 3 }); release();
  assert.equal(await done, true); assert.deepEqual(writes, [1, 3]);
  assert.equal(q.pending, null);
});
test('save failure keeps latest snapshot available for explicit retry', async () => {
  let fail = true, errors = 0; const writes = [];
  const q = new SaveQueue(async data => { if (fail) throw Error('disk'); writes.push(data.n); }, () => errors++);
  assert.equal(await q.enqueue({ n: 1 }), false); assert.equal(errors, 1); assert.equal(q.pending.n, 1);
  fail = false; assert.equal(await q.enqueue({ n: 2 }), true); assert.deepEqual(writes, [2]);
});
