'use strict';
const { setTimeout: wait } = require('node:timers/promises');
const { evaluate, cdp, setup, cleanup } = require('./live-helper.cjs');
async function settle() {
  return evaluate(`
    const p=app.plugins.plugins['sparse-sort'];
    for(let i=0;i<60&&p.moves.busy;i++)await new Promise(r=>setTimeout(r,50));
    if(p.moves.busy)throw Error('Move timed out');
    await p.writer.flush();return true;
  `);
}
async function reveal() {
  evaluate(`
    const p=app.plugins.plugins['sparse-sort'],v=p.views()[0],f=globalThis.__sparseSortFixture.folder;
    v.fileItems[f+'/ZSpacers']?.setCollapsed(false);
    v.revealInFolder(app.vault.getAbstractFileByPath(f+'/Sub/X.md'));
    await new Promise(r=>setTimeout(r,150));
    const row=v.fileItems[f+'/Sub/X.md'].selfEl.getBoundingClientRect(),container=v.navFileContainerEl.getBoundingClientRect();
    v.navFileContainerEl.scrollTop+=row.top-(container.top+250);
    await new Promise(r=>setTimeout(r,100));return true;
  `);
}
async function drag(target, side, hold = 80, shift = 0) {
  const points = evaluate(`
    const p=app.plugins.plugins['sparse-sort'],v=p.views()[0],f=globalThis.__sparseSortFixture.folder;
    const from=v.fileItems[f+'/Sub/X.md'].selfEl.querySelector('.ss-handle').getBoundingClientRect();
    const to=v.fileItems[f+${JSON.stringify('/' + target)}].selfEl.getBoundingClientRect();
    return {from:{x:from.left+from.width/2,y:from.top+from.height/2},to:{x:from.left+from.width/2-${shift},y:${side === 'center' ? 'to.top+to.height/2' : side === 'before' ? 'to.top+2' : 'to.bottom-2'}}};
  `);
  cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points.from] }); await wait(50);
  cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [points.to] }); await wait(hold);
  const hint = evaluate(`return document.querySelector('.ss-drop-hint:not([hidden])')?.textContent||'';`);
  if (shift) evaluate(`
    const p=app.plugins.plugins['sparse-sort'],v=p.views()[0],f=globalThis.__sparseSortFixture.folder;
    const line=document.querySelector('.ss-drop-line:not([hidden])');
    if(!line||parseFloat(line.style.left)>v.fileItems[f+'/Sub'].selfEl.getBoundingClientRect().left+5)throw Error('The insertion line did not promote to the parent indentation');
    return true;
  `);
  cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await wait(80); await settle();
  return hint;
}
(async () => {
  try {
    setup(true);
    evaluate(`
      const p=app.plugins.plugins['sparse-sort'],f=globalThis.__sparseSortFixture.folder;
      await app.vault.createFolder(f+'/Sub');await app.vault.createFolder(f+'/Dest');
      await app.vault.create(f+'/Sub/X.md','Temporary move fixture');
      await app.vault.create(f+'/Sub/Y.md','Temporary move fixture');
      await app.vault.createFolder(f+'/ZSpacers');
      for(let i=0;i<32;i++)await app.vault.create(f+'/ZSpacers/'+String(i).padStart(2,'0')+'.md','Temporary scroll spacer');
      p.store.data.orders[f]=['A.md','Dest','Sub','B.md','C.md','ZSpacers'];p.changed();await p.writer.flush();return true;
    `);
    cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await reveal();
    await drag('Dest', 'center');
    console.log(evaluate(`const f=globalThis.__sparseSortFixture.folder;if(!app.vault.getAbstractFileByPath(f+'/Sub/X.md'))throw Error('A quick folder hover moved the file');return {quickHoverDoesNotMove:true};`));
    await reveal(); await drag('Dest', 'center', 720);
    console.log(evaluate(`const p=app.plugins.plugins['sparse-sort'],f=globalThis.__sparseSortFixture.folder;if(!app.vault.getAbstractFileByPath(f+'/Dest/X.md'))throw Error('Dwell did not move into folder');await p.moves.undo(p.views()[0],p.moves.lastMove);return {dwellMoveAndUndo:true};`));
    await reveal(); await drag('B.md', 'before');
    console.log(evaluate(`
      const p=app.plugins.plugins['sparse-sort'],f=globalThis.__sparseSortFixture.folder;
      if(!app.vault.getAbstractFileByPath(f+'/X.md'))throw Error('Child was not moved to parent');
      if(JSON.stringify(p.store.data.orders[f].slice(0,6))!==JSON.stringify(['A.md','Dest','Sub','X.md','B.md','C.md']))throw Error('Wrong insertion position');
      const notice=[...document.querySelectorAll('.notice')].find(el=>el.textContent.includes('to '+f+'.'));
      if(!notice?.querySelector('button'))throw Error('No undo action was offered');
      notice.querySelector('button').click();
      return {parentInsertion:true,undoButton:true};
    `));
    await wait(150); await settle();
    evaluate(`const f=globalThis.__sparseSortFixture.folder;if(!app.vault.getAbstractFileByPath(f+'/Sub/X.md'))throw Error('Undo button did not restore the file');return true;`);
    await reveal(); const hint = await drag('Sub/Y.md', 'after', 80, 36);
    console.log({ outdentHint: hint });
    console.log(evaluate(`
      const p=app.plugins.plugins['sparse-sort'],f=globalThis.__sparseSortFixture.folder;
      if(!app.vault.getAbstractFileByPath(f+'/X.md'))throw Error('Outdent did not move to parent');
      if(p.store.data.orders[f].indexOf('X.md')!==p.store.data.orders[f].indexOf('Sub')+1)throw Error('Outdent position is wrong');
      await p.moves.undo(p.views()[0],p.moves.lastMove);return {outdentInsertion:true,hint:${JSON.stringify(hint)}};
    `));
    console.log(evaluate(`
      const p=app.plugins.plugins['sparse-sort'],f=globalThis.__sparseSortFixture.folder;
      await p.moves.drop(p.views()[0],[f+'/Sub'],{kind:'inside',path:f+'/Dest'});
      if(!app.vault.getAbstractFileByPath(f+'/Dest/Sub/X.md'))throw Error('Folder subtree was not moved');
      await p.moves.undo(p.views()[0],p.moves.lastMove);
      if(!app.vault.getAbstractFileByPath(f+'/Sub/X.md'))throw Error('Folder undo failed');
      return {folderSubtreeMoveAndUndo:true};
    `));
    evaluate(`const f=globalThis.__sparseSortFixture.folder;await app.vault.delete(app.vault.getAbstractFileByPath(f+'/Sub/Y.md'),true);return true;`);
    await reveal(); await drag('Sub/X.md', 'after', 80, 36);
    console.log(evaluate(`
      const p=app.plugins.plugins['sparse-sort'],f=globalThis.__sparseSortFixture.folder;
      if(!app.vault.getAbstractFileByPath(f+'/X.md'))throw Error('Only-child outdent failed');
      await p.moves.undo(p.views()[0],p.moves.lastMove);return {onlyChildOutdent:true};
    `));
  } finally {
    cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
    console.log(cleanup());
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
