'use strict';
const { parentOf, nameOf, childPath, insertNames, restoreNames } = require('./core.cjs');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

class MoveController {
  constructor(host) { this.host = host; this.busy = false; }
  get store() { return this.host.getStore(); }
  async drop(view, paths, target) {
    if (this.busy) throw Error('Wait for the previous move to finish.');
    const source = paths.map(path => this.host.resolve(path));
    if (!source.length || source.some(file => !file)) throw Error('A dragged item no longer exists.');
    const sourceParent = parentOf(source[0].path);
    if (source.some(file => parentOf(file.path) !== sourceParent)) throw Error('Select items from the same folder.');
    if (paths.includes(target.path)) return false;
    const anchor = this.host.resolve(target.path);
    if (!anchor) throw Error('The target no longer exists.');
    const parent = target.kind === 'inside' ? anchor.path : parentOf(anchor.path);
    const folder = this.host.resolve(parent);
    if (!folder || !Array.isArray(folder.children)) throw Error('The destination is not a folder.');
    if (source.some(file => parent === file.path || parent.startsWith(file.path + '/'))) throw Error('A folder cannot be moved into itself or a descendant.');
    if (target.kind !== 'inside' && source.some(file => this.store.pinned.has(file.path) !== this.store.pinned.has(anchor.path))) {
      throw Error('Pinned and unpinned items must stay in their own groups.');
    }
    const sourceDisplay = this.host.sorted(view, sourceParent);
    const ranks = new Map(sourceDisplay.map((name, index) => [name, index]));
    source.sort((a, b) => (ranks.get(a.name) ?? Infinity) - (ranks.get(b.name) ?? Infinity));
    const moving = source.map(file => file.name);
    const current = this.host.sorted(view, parent);
    const next = insertNames(current, moving, target.kind === 'inside' ? null : anchor.name, target.after);
    if (parent === sourceParent) {
      if (equal(current, next)) return false;
      this.store.data.orders[parent] = next;
      await this.host.commit(); return true;
    }
    const normalized = name => name.normalize('NFC').toLowerCase();
    const occupied = new Map(folder.children.map(file => [normalized(file.name), file]));
    for (const file of source) {
      const existing = this.host.resolve(childPath(parent, file.name)) || occupied.get(normalized(file.name));
      if (existing && existing !== file) throw Error(`An item named ${file.name} already exists in ${parent}. Nothing was moved.`);
      occupied.set(normalized(file.name), file);
    }
    const transaction = {
      parent, sourceParent, sourceDisplay,
      sourceBefore: this.store.data.orders[sourceParent]?.slice() ?? null,
      targetBefore: this.store.data.orders[parent]?.slice() ?? null,
      targetAfter: next.slice(), moved: [], used: false,
    };
    this.busy = true;
    try {
      for (const file of source) {
        const oldPath = file.path, newPath = childPath(parent, file.name);
        transaction.moved.push({ file, oldPath, newPath });
        await this.host.rename(file, newPath);
      }
      this.store.data.orders[parent] = next;
    } catch (error) {
      const failures = [];
      for (const item of transaction.moved.slice().reverse()) {
        if (item.file.path === item.oldPath) continue;
        try {
          if (item.file.path !== item.newPath) throw Error('Item changed during move');
          if (this.host.resolve(item.oldPath)) throw Error('Original path is occupied');
          await this.host.rename(item.file, item.oldPath);
        } catch { failures.push(item.newPath); }
      }
      this.restoreSource(view, transaction, transaction.moved.filter(item => item.file.path === item.oldPath));
      throw Error(`${error.message} ${failures.length ? 'Some items could not be rolled back: ' + failures.join(', ') : 'Completed moves were rolled back.'}`);
    } finally { this.busy = false; await this.host.commit(); }
    this.lastMove = transaction;
    this.host.announce?.(source.length, parent, () => this.undo(view, transaction));
    return true;
  }
  restoreSource(view, transaction, restored) {
    if (transaction.sourceBefore && restored.length) {
      this.store.data.orders[transaction.sourceParent] = restoreNames(
        this.host.sorted(view, transaction.sourceParent), transaction.sourceDisplay, restored.map(item => nameOf(item.oldPath)));
    }
  }
  async undo(view, transaction) {
    if (this.busy) throw Error('Wait for the previous move to finish.');
    if (transaction.used) throw Error('This move has already been undone.');
    for (const item of transaction.moved) {
      if (item.file.path !== item.newPath || this.host.resolve(item.newPath) !== item.file || this.host.resolve(item.oldPath)) {
        throw Error('Cannot undo: an item changed or its original path is occupied.');
      }
      const parent = this.host.resolve(parentOf(item.oldPath));
      if (!parent || !Array.isArray(parent.children)) throw Error('The original folder no longer exists.');
    }
    this.busy = true;
    const restored = [];
    try {
      for (const item of transaction.moved.slice().reverse()) {
        restored.push(item); await this.host.rename(item.file, item.oldPath);
      }
      const expected = transaction.targetAfter.filter(name => !transaction.moved.some(item => nameOf(item.newPath) === name));
      if (equal(this.store.data.orders[transaction.parent] || [], expected)) {
        if (transaction.targetBefore) this.store.data.orders[transaction.parent] = transaction.targetBefore;
        else this.store.reset(transaction.parent);
      }
    } catch (error) {
      throw Error(`Undo stopped after restoring ${restored.filter(item => item.file.path === item.oldPath).length} item(s): ${error.message}`);
    } finally {
      const completed = restored.filter(item => item.file.path === item.oldPath);
      this.restoreSource(view, transaction, completed);
      if (completed.length) transaction.used = true;
      this.busy = false; await this.host.commit();
    }
  }
}
module.exports = { MoveController };
