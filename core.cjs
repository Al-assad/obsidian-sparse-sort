'use strict';

const parentOf = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) || '/' : '/';
const nameOf = path => path.slice(path.lastIndexOf('/') + 1);
const childPath = (parent, name) => parent === '/' ? name : `${parent}/${name}`;
const inside = (path, root) => path === root || path.startsWith(`${root}/`);
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const names = values => [...new Set((Array.isArray(values) ? values : []).filter(
  v => typeof v === 'string' && v && !v.includes('/') && v !== '.' && v !== '..'))];

function normalize(raw = {}) {
  if (raw.version != null && raw.version !== 1) throw new Error('Unsupported settings version');
  const orders = Object.create(null);
  for (const [path, order] of Object.entries(raw.orders || {})) {
    const clean = names(order);
    if (clean.length) orders[path] = clean;
  }
  const paths = value => [...new Set((Array.isArray(value) ? value : []).filter(
    p => typeof p === 'string' && p && p !== '/'))];
  return { version: 1, orders, pinned: paths(raw.pinned), hidden: paths(raw.hidden),
    hidePatterns: paths(raw.hidePatterns), showHidden: raw.showHidden === true };
}

// Same glob vocabulary as Flexplorer: *, **, ?, and / anchored at vault root.
function compileGlob(pattern) {
  const anchored = pattern.startsWith('/');
  if (anchored) pattern = pattern.slice(1);
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') { i++; source += '(?:.*/)?'; }
      else source += '.*';
    } else if (c === '*') source += '[^/]*';
    else if (c === '?') source += '[^/]';
    else source += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${anchored || pattern.includes('/') ? '' : '(?:[^/]*/)*'}${source}$`);
}

class SortStore {
  constructor(raw) { this.replace(raw); }
  replace(raw) {
    this.data = normalize(raw);
    this.reindex();
  }
  reindex() {
    this.pinned = new Set(this.data.pinned);
    this.pinParents = new Set(this.data.pinned.map(parentOf));
    this.hidden = new Set(this.data.hidden);
    this.patterns = this.data.hidePatterns.map(compileGlob);
  }
  isHidden(path) {
    if (this.data.showHidden) return false;
    for (let p = path; p && p !== '/'; p = parentOf(p)) {
      if (this.hidden.has(p) || this.patterns.some(re => re.test(p))) return true;
    }
    return false;
  }
  // Keep the native array untouched, including its tie breakers and folder grouping.
  apply(parent, native, includeHidden = false) {
    const order = this.data.orders[parent];
    const pin = this.pinParents.has(parent);
    const hide = !includeHidden && !this.data.showHidden && (this.hidden.size || this.patterns.length);
    if (!order && !pin && !hide) return native;
    const base = hide ? native.filter(item => !this.isHidden(item.file.path)) : native;
    let arranged = base;
    if (order) {
      const live = new Map(base.map(item => [item.file.name, item]));
      arranged = [];
      for (const name of order) {
        const item = live.get(name);
        if (item) { arranged.push(item); live.delete(name); }
      }
      for (const item of base) if (live.has(item.file.name)) arranged.push(item);
    }
    if (!pin) return arranged;
    const first = [], rest = [];
    for (const item of arranged) (this.pinned.has(item.file.path) ? first : rest).push(item);
    return first.concat(rest);
  }
  reorder(parent, current, moving, target, after) {
    moving = names(moving);
    const selected = new Set(moving);
    if (!moving.length || selected.has(target) || !current.includes(target) ||
        moving.some(name => !current.includes(name))) return false;
    const pinned = this.pinned.has(childPath(parent, target));
    if (moving.some(name => this.pinned.has(childPath(parent, name)) !== pinned)) return false;
    const block = current.filter(name => selected.has(name));
    const next = current.filter(name => !selected.has(name));
    next.splice(next.indexOf(target) + (after ? 1 : 0), 0, ...block);
    if (equal(current, next)) return false;
    this.data.orders[parent] = next;
    return true;
  }
  reset(path) {
    if (!Object.hasOwn(this.data.orders, path)) return false;
    delete this.data.orders[path]; return true;
  }
  toggle(kind, path) {
    const set = new Set(this.data[kind]);
    if (set.has(path)) set.delete(path); else set.add(path);
    this.data[kind] = [...set]; this.reindex();
  }
  rename(oldPath, newPath) {
    if (oldPath === newPath) return false;
    let changed = false;
    const oldParent = parentOf(oldPath), newParent = parentOf(newPath);
    const order = this.data.orders[oldParent];
    if (order?.includes(nameOf(oldPath))) {
      const next = order.flatMap(n => n !== nameOf(oldPath) ? [n] :
        oldParent === newParent ? [nameOf(newPath)] : []);
      if (next.length) this.data.orders[oldParent] = next;
      else delete this.data.orders[oldParent];
      changed = true;
    }
    const remap = path => inside(path, oldPath) ? newPath + path.slice(oldPath.length) : path;
    // Only traverse saved directories/flags, never vault files or folder descendants.
    const orders = Object.create(null);
    for (const [path, value] of Object.entries(this.data.orders)) {
      const next = remap(path); orders[next] = value; changed ||= next !== path;
    }
    this.data.orders = orders;
    for (const kind of ['pinned', 'hidden']) this.data[kind] = this.data[kind].map(path => {
      const next = remap(path); changed ||= next !== path; return next;
    });
    if (changed) this.reindex();
    return changed;
  }
  remove(path) {
    let changed = false;
    const order = this.data.orders[parentOf(path)];
    if (order?.includes(nameOf(path))) {
      const next = order.filter(name => name !== nameOf(path));
      if (next.length) this.data.orders[parentOf(path)] = next;
      else delete this.data.orders[parentOf(path)];
      changed = true;
    }
    for (const key of Object.keys(this.data.orders)) if (inside(key, path)) {
      delete this.data.orders[key]; changed = true;
    }
    for (const kind of ['pinned', 'hidden']) {
      const old = this.data[kind];
      this.data[kind] = old.filter(p => !inside(p, path));
      changed ||= old.length !== this.data[kind].length;
    }
    if (changed) this.reindex();
    return changed;
  }
  importLegacy(raw, selected, exists) {
    const next = normalize(this.data);
    for (const path of selected) {
      const old = raw.items?.[path];
      if (!old || !Array.isArray(old.customOrder)) continue;
      const order = names(old.customOrder).filter(name => exists(childPath(path, name)));
      if (order.length) next.orders[path] = order;
    }
    for (const [kind, flag] of [['pinned', 'isPinned'], ['hidden', 'isHidden']]) {
      next[kind] = [...new Set(next[kind].concat(Object.entries(raw.items || {})
        .filter(([p, s]) => s[flag] && exists(p)).map(([p]) => p)))];
    }
    next.hidePatterns = [...new Set(next.hidePatterns.concat(raw.hidePatterns || []))];
    this.replace(next);
  }
}

// Start on the next microtask; collapse bursts and serialize immutable snapshots.
// A failed snapshot stays pending for retry. Never continue retrying in a busy loop.
class SaveQueue {
  constructor(save, onError = () => {}) {
    this.save = save; this.onError = onError; this.pending = null; this.running = null;
  }
  enqueue(data) {
    this.pending = JSON.parse(JSON.stringify(data));
    return this.flush();
  }
  flush() {
    if (this.running) return this.running;
    let failed = false;
    this.running = Promise.resolve().then(async () => {
      while (this.pending) {
        const value = this.pending; this.pending = null;
        try { await this.save(value); }
        catch (error) {
          failed = true;
          if (!this.pending) this.pending = value;
          this.onError(error); return false;
        }
      }
      return true;
    }).finally(() => {
      this.running = null;
      if (this.pending && !failed) return this.flush();
    });
    return this.running;
  }
}

module.exports = { SortStore, SaveQueue, normalize, parentOf, nameOf, childPath, compileGlob };
