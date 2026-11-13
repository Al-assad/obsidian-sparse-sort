'use strict';
const { Plugin, PluginSettingTab, Setting, Modal, Menu, Notice, TFolder, setIcon } = require('obsidian');
const { SortStore, SaveQueue, parentOf, nameOf } = require('./core.cjs');

class SparseSort extends Plugin {
  async onload() {
    try { this.store = new SortStore(await this.loadData() || {}); }
    catch (error) { new Notice(`Sparse Sort could not load: ${error.message}`); return; }
    this.writer = new SaveQueue(data => this.saveData(data), error => {
      console.error('Sparse Sort could not save settings', error);
      new Notice('Could not save order. Changes remain in memory. Run the Retry saving order command.', 10000);
    });
    this.bindings = new Map(); this.patches = new Map(); this.editing = false; this.active = true;
    this.addSettingTab(new SparseSettings(this.app, this));
    this.addCommand({ id: 'toggle-reorder', name: 'Toggle touch reorder handles', callback: () => this.toggleEditing() });
    this.addCommand({ id: 'import-flexplorer', name: 'Import from Flexplorer and switch', callback: () => void this.openImport() });
    this.addCommand({ id: 'toggle-hidden', name: 'Toggle hidden items', callback: () => this.toggleHidden() });
    this.addCommand({ id: 'retry-save', name: 'Retry saving order', callback: () => void this.writer.flush().then(ok => {
      if (ok) new Notice('Order saved');
    }) });
    this.addCommand({ id: 'reset-root', name: 'Restore native root order', callback: () => this.reset('/') });
    this.addRibbonIcon('list-ordered', 'Sparse Sort: touch reorder handles', () => this.toggleEditing());
    this.registerEvent(this.app.vault.on('rename', (file, old) => {
      if (this.store.rename(old, file.path)) this.changed();
    }));
    this.registerEvent(this.app.vault.on('delete', file => {
      if (this.store.remove(file.path)) this.changed();
    }));
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => this.fileMenu(menu, file)));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.attachViews()));
    this.app.workspace.onLayoutReady(() => {
      if (!this._loaded) return;
      this.attachViews();
      if (this.conflicted()) new Notice('Sparse Sort is ready. Import and switch in its settings; Flexplorer is still active.', 9000);
    });
    // Also flush when iOS backgrounds the document, rather than waiting for onunload.
    this.registerDomEvent(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.writer.flush();
    });
  }
  conflicted() { return this.app.plugins.enabledPlugins.has('flexplorer'); }
  usable() {
    if (this.conflicted()) { new Notice('Import and switch in Sparse Sort settings before using two sorting plugins.'); return false; }
    return this.patches.size > 0;
  }
  views() { return this.app.workspace.getLeavesOfType('file-explorer').map(leaf => leaf.view); }
  attachViews() {
    if (!this.bindings || this.conflicted()) return;
    const views = this.views();
    for (const [view, binding] of this.bindings) if (!views.includes(view) || binding.el !== view.navFileContainerEl) {
      binding.dispose(); this.bindings.delete(view);
    }
    for (const view of views) {
      const proto = Object.getPrototypeOf(view);
      if (!this.patches.has(proto)) {
        const original = proto.getSortedFolderItems;
        if (typeof original !== 'function') {
          new Notice('Sparse Sort: unsupported file explorer interface. Native sorting has been left in place.'); continue;
        }
        const plugin = this;
        const wrapper = function(folder) {
          const native = original.call(this, folder);
          return plugin.active && !plugin.conflicted() ? plugin.store.apply(folder.path, native) : native;
        };
        proto.getSortedFolderItems = wrapper;
        this.patches.set(proto, { original, wrapper });
      }
      if (!this.bindings.has(view) && view.navFileContainerEl) this.bindings.set(view, new ExplorerBinding(this, view));
    }
  }
  refresh() {
    for (const view of this.views()) view.requestSort?.();
    for (const binding of this.bindings?.values() || []) binding.decorate(binding.el);
  }
  changed() { void this.writer.enqueue(this.store.data); this.refresh(); }
  reset(path) { if (this.store.reset(path)) this.changed(); }
  toggleEditing() {
    if (!this.usable()) return;
    this.editing = !this.editing;
    for (const binding of this.bindings.values()) binding.updateMode();
    new Notice(this.editing ? 'Drag the handles to reorder. Changes save automatically when you release.' : 'Touch reorder mode off');
  }
  toggleHidden() {
    if (!this.usable()) return;
    this.store.data.showHidden = !this.store.data.showHidden; this.changed();
  }
  reorder(view, paths, targetPath, after) {
    if (this.conflicted() || !paths.length || paths.includes(targetPath)) return false;
    const parent = parentOf(targetPath);
    if (paths.some(path => parentOf(path) !== parent)) return false;
    const folder = this.app.vault.getAbstractFileByPath(parent);
    const patch = this.patches.get(Object.getPrototypeOf(view));
    if (!(folder instanceof TFolder) || !patch) return false;
    const current = this.store.apply(parent, patch.original.call(view, folder), true).map(item => item.file.name);
    if (!this.store.reorder(parent, current, paths.map(nameOf), nameOf(targetPath), after)) return false;
    this.changed(); return true;
  }
  fileMenu(menu, file) {
    if (!this.store || this.conflicted()) return;
    menu.addItem(item => {
      item.setTitle('Sparse Sort').setIcon('list-ordered');
      const child = item.setSubmenu();
      if (file instanceof TFolder) child.addItem(it => it.setTitle('Restore native folder order')
        .setDisabled(!Object.hasOwn(this.store.data.orders, file.path)).onClick(() => this.reset(file.path)));
      if (file.path !== '/') {
        child.addItem(it => it.setTitle(this.store.pinned.has(file.path) ? 'Unpin' : 'Pin')
          .setIcon('pin').onClick(() => { this.store.toggle('pinned', file.path); this.changed(); }));
        child.addItem(it => it.setTitle(this.store.hidden.has(file.path) ? 'Unhide' : 'Hide')
          .setIcon('eye-off').onClick(() => { this.store.toggle('hidden', file.path); this.changed(); }));
      }
      child.addItem(it => it.setTitle(this.store.data.showHidden ? 'Hide hidden items' : 'Show hidden items')
        .onClick(() => this.toggleHidden()));
      child.addItem(it => it.setTitle(this.editing ? 'Turn off touch reorder handles' : 'Turn on touch reorder handles')
        .onClick(() => this.toggleEditing()));
    });
  }
  async openImport() {
    try {
      const adapter = this.app.vault.adapter;
      let path = `${this.app.vault.configDir}/plugins/flexplorer/data.json`;
      if (!await adapter.exists(path)) {
        const backup = `${this.manifest.dir}/backups`;
        const files = await adapter.exists(backup) ? (await adapter.list(backup)).files : [];
        path = files.filter(file => nameOf(file).startsWith('flexplorer-') && file.endsWith('.json')).sort().at(-1);
        if (!path) throw new Error('No Flexplorer settings or import backup found');
      }
      const raw = JSON.parse(await adapter.read(path));
      new ImportModal(this.app, this, raw).open();
    } catch (error) { new Notice(`Could not read legacy settings: ${error.message}`); }
  }
  async importAndSwitch(raw, selected) {
    const adapter = this.app.vault.adapter;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${this.manifest.dir}/backups`;
    if (!await adapter.exists(backup)) await adapter.mkdir(backup);
    await adapter.write(`${backup}/flexplorer-${stamp}.json`, JSON.stringify(raw, null, 2));
    await adapter.write(`${backup}/sparse-sort-${stamp}.json`, JSON.stringify(this.store.data, null, 2));
    this.store.importLegacy(raw, selected, path => !!this.app.vault.getAbstractFileByPath(path));
    const ok = await this.writer.enqueue(this.store.data);
    if (!ok) throw new Error('New settings could not be saved; the old plugin remains active');
    if (this.conflicted()) {
      if (typeof this.app.plugins.disablePluginAndSave !== 'function') throw new Error('Disable Flexplorer in Community plugins, then reload Sparse Sort');
      await this.app.plugins.disablePluginAndSave('flexplorer');
    }
    this.attachViews(); this.refresh();
    new Notice(`Imported ${selected.length} folders and switched. Legacy settings are backed up in Sparse Sort/backups.`, 9000);
  }
  async onExternalSettingsChange() {
    if (!this.writer) return;
    if (this.writer.pending || this.writer.running) {
      new Notice('External settings changed while a local save is pending. Avoid reordering on two devices at once.', 10000); return;
    }
    try { this.store.replace(await this.loadData() || {}); this.refresh(); }
    catch (error) { new Notice(`External settings could not be loaded: ${error.message}`); }
  }
  onunload() {
    this.active = false;
    for (const binding of this.bindings?.values() || []) binding.dispose();
    for (const [proto, patch] of this.patches || []) {
      if (proto.getSortedFolderItems === patch.wrapper) proto.getSortedFolderItems = patch.original;
    }
    this.patches?.clear(); this.bindings?.clear();
    this.refresh(); void this.writer?.flush();
  }
}

class ExplorerBinding {
  constructor(plugin, view) {
    this.plugin = plugin; this.view = view; this.el = view.navFileContainerEl;
    this.doc = this.el.ownerDocument; this.win = this.doc.defaultView; this.cleanups = [];
    this.active = null; this.target = null; this.frame = 0; this.lastPoint = null;
    const header = view.containerEl.querySelector('.nav-buttons-container');
    if (header) {
      this.button = header.createEl('div', { cls: 'clickable-icon nav-action-button ss-toggle', attr: {
        'aria-label': 'Reorder items (automatically saved)', role: 'button', tabindex: '0' } });
      setIcon(this.button, 'list-ordered');
      this.listen(this.button, 'click', () => plugin.toggleEditing());
      this.listen(this.button, 'contextmenu', event => {
        event.preventDefault(); event.stopPropagation();
        this.menu?.hide();
        this.menu = new Menu().setUseNativeMenu(false);
        plugin.fileMenu(this.menu, plugin.app.vault.getRoot()); this.menu.showAtMouseEvent(event);
      });
      this.listen(this.button, 'keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); plugin.toggleEditing(); } });
    }
    this.listen(this.el, 'dragstart', e => this.dragStart(e), true);
    this.listen(this.el, 'dragover', e => this.dragOver(e), true);
    this.listen(this.el, 'drop', e => this.drop(e), true);
    this.listen(this.doc, 'dragend', () => this.clear(), true);
    this.listen(this.doc, 'drop', event => { if (!this.el.contains(event.target)) this.clear(); }, true);
    this.listen(this.doc, 'dragover', event => {
      if (this.active && !this.active.touch && !this.el.contains(event.target)) {
        this.clearTarget();
        if (this.frame) this.win.cancelAnimationFrame(this.frame);
        this.frame = 0;
      }
    }, true);
    this.listen(this.el, 'pointerdown', e => this.pointerDown(e), { capture: true, passive: false });
    this.listen(this.el, 'pointermove', e => this.pointerMove(e), { passive: false });
    this.listen(this.el, 'pointerup', e => this.pointerUp(e), true);
    this.listen(this.el, 'pointercancel', () => this.clear(), true);
    this.listen(this.el, 'lostpointercapture', () => this.clear(), true);
    this.listen(this.doc, 'keydown', e => { if (e.key === 'Escape') this.clear(); });
    this.listen(this.win, 'blur', () => this.clear());
    this.listen(this.el, 'contextmenu', e => {
      if (e.target.closest?.('.ss-handle')) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    this.listen(this.el, 'click', e => {
      if (e.target.closest?.('.ss-handle')) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    this.observer = new this.win.MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1 && !node.matches('.ss-handle, .ss-pin')) this.decorate(node);
    });
    this.observer.observe(this.el, { childList: true, subtree: true });
    this.decorate(this.el);
    this.updateMode();
  }
  listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    this.cleanups.push(() => target.removeEventListener(type, listener, options));
  }
  decorate(root) {
    const selector = '.nav-file-title, .nav-folder-title';
    const titles = root.matches?.(selector) ? [root] : [];
    titles.push(...root.querySelectorAll(selector));
    for (const title of titles) {
      // Flexplorer leaves decorations on reused tree rows after unload.
      title.querySelectorAll('.fp-indicator').forEach(el => el.remove());
      title.parentElement?.classList.remove('fp-hidden');
      const pinned = this.plugin.store.pinned.has(title.getAttribute('data-path'));
      const indicator = title.querySelector(':scope > .ss-pin');
      if (pinned && !indicator) setIcon(title.createEl('span', { cls: 'ss-pin', attr: { 'aria-label': 'Pinned' } }), 'pin');
      if (!pinned) indicator?.remove();
      if (this.plugin.editing && !title.querySelector(':scope > .ss-handle')) {
        const handle = title.createEl('span', { cls: 'ss-handle', attr: { 'aria-label': 'Drag to reorder', draggable: 'false' } });
        setIcon(handle, 'grip-vertical');
      }
    }
  }
  updateMode() {
    this.el.classList.toggle('ss-editing', this.plugin.editing);
    this.button?.classList.toggle('is-active', this.plugin.editing);
    this.button?.setAttribute('aria-pressed', String(this.plugin.editing));
    if (this.plugin.editing) this.decorate(this.el); else this.clear();
  }
  titleAt(node) { return node?.closest?.('.nav-file-title, .nav-folder-title'); }
  fileAt(title) {
    const path = title?.getAttribute('data-path');
    return path ? this.plugin.app.vault.getAbstractFileByPath(path) : null;
  }
  dragStart(event) {
    this.clear();
    const file = this.fileAt(this.titleAt(event.target));
    if (!file) return;
    const selected = [...(this.view.tree?.selectedDoms || [])].map(item => item.file?.path).filter(Boolean);
    const paths = selected.includes(file.path) ? selected : [file.path];
    this.active = { paths, parent: parentOf(file.path), touch: false,
      mixed: paths.some(path => parentOf(path) !== parentOf(file.path)) };
  }
  updateTarget(x, y) {
    this.clearTarget();
    if (!this.active) return;
    const hit = this.doc.elementFromPoint(x, y);
    if (!hit || !this.el.contains(hit)) return;
    const title = this.titleAt(hit);
    const file = this.fileAt(title);
    if (!file || parentOf(file.path) !== this.active.parent || this.active.paths.includes(file.path)) return;
    // The middle of a folder remains an ordinary native move target on desktop.
    const rect = title.getBoundingClientRect();
    if (!this.active.touch && file instanceof TFolder && y > rect.top + rect.height * .25 && y < rect.bottom - rect.height * .25) return;
    const pinned = this.plugin.store.pinned.has(file.path);
    if (this.active.paths.some(path => this.plugin.store.pinned.has(path) !== pinned)) return;
    this.target = { path: file.path, after: y >= rect.top + rect.height / 2, title };
    title.dataset.ssDrop = this.target.after ? 'after' : 'before';
  }
  schedule(x, y) {
    this.lastPoint = { x, y };
    if (!this.frame) this.frame = this.win.requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.active) return;
      const { x, y } = this.lastPoint;
      this.updateTarget(x, y);
      const rect = this.el.getBoundingClientRect();
      const edge = 40;
      const delta = y < rect.top + edge ? -10 : y > rect.bottom - edge ? 10 : 0;
      if (delta && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        const before = this.el.scrollTop; this.el.scrollTop += delta;
        if (before !== this.el.scrollTop) this.schedule(x, y);
      }
    });
  }
  dragOver(event) {
    if (!this.active || this.active.touch) return;
    this.updateTarget(event.clientX, event.clientY);
    if (this.target) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      this.schedule(event.clientX, event.clientY);
    }
  }
  drop(event) {
    if (!this.active || this.active.touch) return;
    this.updateTarget(event.clientX, event.clientY);
    if (this.target) {
      event.preventDefault(); event.stopImmediatePropagation(); this.commit();
    }
    this.clear();
  }
  pointerDown(event) {
    if (!this.plugin.editing || event.button !== 0 || !event.target.closest?.('.ss-handle')) return;
    const title = this.titleAt(event.target), file = this.fileAt(title);
    if (!file) return;
    event.preventDefault(); event.stopImmediatePropagation(); this.clear();
    this.active = { paths: [file.path], parent: parentOf(file.path), touch: true, pointer: event.pointerId };
    this.el.setPointerCapture(event.pointerId);
    this.el.classList.add('ss-dragging');
  }
  pointerMove(event) {
    if (!this.active?.touch || this.active.pointer !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation(); this.schedule(event.clientX, event.clientY);
  }
  pointerUp(event) {
    if (!this.active?.touch || this.active.pointer !== event.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.updateTarget(event.clientX, event.clientY); this.commit(); this.clear();
  }
  commit() {
    if (!this.target || !this.active) return;
    if (this.active.mixed) { new Notice('Select items from the same folder to reorder them'); return; }
    this.plugin.reorder(this.view, this.active.paths, this.target.path, this.target.after);
  }
  clearTarget() { if (this.target) delete this.target.title.dataset.ssDrop; this.target = null; }
  clear() {
    if (this.frame) this.win.cancelAnimationFrame(this.frame);
    this.frame = 0; this.clearTarget();
    const pointer = this.active?.pointer; this.active = null;
    if (pointer != null && this.el.hasPointerCapture(pointer)) this.el.releasePointerCapture(pointer);
    this.el.classList.remove('ss-dragging');
  }
  dispose() {
    this.clear(); this.menu?.hide(); this.observer.disconnect(); this.cleanups.forEach(fn => fn()); this.button?.remove();
    this.el.classList.remove('ss-editing'); this.el.querySelectorAll('.ss-handle, .ss-pin').forEach(el => el.remove());
  }
}

class ImportModal extends Modal {
  constructor(app, plugin, raw) {
    super(app); this.plugin = plugin; this.raw = raw;
    this.folders = Object.entries(raw.items || {}).filter(([path, s]) =>
      s.sortOrder === 'custom' && s.customOrder?.length && app.vault.getAbstractFileByPath(path) instanceof TFolder)
      .map(([path, s]) => ({ path, count: s.customOrder.length })).sort((a, b) =>
        (a.path === '/' ? -1 : a.path.split('/').length) - (b.path === '/' ? -1 : b.path.split('/').length) || a.path.localeCompare(b.path));
    this.selected = new Set(this.folders.filter(f => f.path === '/' || !f.path.includes('/')).map(f => f.path));
  }
  onOpen() {
    this.titleEl.setText('Import from Flexplorer and switch');
    this.contentEl.createEl('p', { text: 'Flexplorer does not distinguish automatic order from manual edits. Root and top-level folders are selected by default. Choose any additional folders to keep. Pins, hidden items, and hide patterns are included. Selected folder orders replace existing ones. Both configurations are backed up before switching; the old plugin is kept.' });
    const filter = this.contentEl.createEl('input', { type: 'search', placeholder: 'Filter folder paths', cls: 'ss-import-filter' });
    const counter = this.contentEl.createEl('p');
    const update = () => counter.setText(`${this.selected.size} / ${this.folders.length} folders selected`);
    const list = this.contentEl.createDiv({ cls: 'ss-import-list' });
    const render = () => {
      list.empty();
      for (const folder of this.folders.filter(f => f.path.toLowerCase().includes(filter.value.toLowerCase()))) {
        new Setting(list).setName(folder.path).setDesc(`${folder.count} items`).addToggle(toggle => toggle
          .setValue(this.selected.has(folder.path)).onChange(value => {
            if (value) this.selected.add(folder.path); else this.selected.delete(folder.path); update();
          }));
      }
    };
    filter.addEventListener('input', render); update(); render();
    new Setting(this.contentEl).addButton(button => button.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(button => button.setButtonText('Import and switch').setCta().onClick(async () => {
        button.setDisabled(true);
        try { await this.plugin.importAndSwitch(this.raw, [...this.selected]); this.close(); }
        catch (error) { new Notice(`Could not finish switching: ${error.message}`, 10000); button.setDisabled(false); }
      }));
  }
  onClose() { this.contentEl.empty(); }
}

class SparseSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const el = this.containerEl, p = this.plugin; el.empty();
    el.createEl('h2', { text: 'Sparse Sort' });
    el.createEl('p', { text: 'Drag within a folder to reorder and save automatically. Untouched folders keep native sorting. On mobile, enable touch handles. Use native actions to move files between folders.' });
    if (p.conflicted()) el.createEl('p', { cls: 'ss-conflict', text: 'Flexplorer is still enabled. Sparse Sort will wait until you import and switch.' });
    new Setting(el).setName('Import from Flexplorer').setDesc('Choose folders to keep, back up both configurations, then disable the old plugin.')
      .addButton(b => b.setButtonText('Preview import').onClick(() => void p.openImport()));
    new Setting(el).setName('Touch reorder handles').setDesc('Also available from the file explorer toolbar. Release to save automatically.')
      .addToggle(t => t.setValue(p.editing).onChange(() => p.toggleEditing()));
    new Setting(el).setName('Show hidden items').addToggle(t => t.setValue(p.store.data.showHidden).onChange(value => {
      p.store.data.showHidden = value; p.changed();
    }));
    new Setting(el).setName('Hide patterns').setDesc('One pattern per line. Supports *, **, and ?. Start with / to match from the vault root.')
      .addTextArea(t => {
        t.setValue(p.store.data.hidePatterns.join('\n'));
        // Commit on blur so typing a rule does not write on every keystroke.
        t.inputEl.addEventListener('change', () => {
          p.store.data.hidePatterns = [...new Set(t.inputEl.value.split('\n').map(s => s.trim()).filter(Boolean))];
          p.store.reindex(); p.changed();
        });
      });
    const orders = Object.keys(p.store.data.orders);
    el.createEl('h3', { text: `Manually ordered folders (${orders.length})` });
    for (const path of orders.sort()) new Setting(el).setName(path)
      .setDesc(`${p.store.data.orders[path].length} items`).addButton(b => b.setButtonText('Restore native').onClick(() => { p.reset(path); this.display(); }));
    if (!orders.length) el.createEl('p', { text: 'No saved orders yet. A folder is recorded after the first effective reorder.' });
    el.createEl('p', { text: 'Settings can sync between devices. Avoid reordering on two devices at once; concurrent edits are not merged.' });
  }
}

module.exports = SparseSort;
