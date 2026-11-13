'use strict';
const { execFileSync } = require('node:child_process');
function call(...args) {
  const vault = process.env.OBSIDIAN_TEST_VAULT;
  if (!vault) throw Error('Set OBSIDIAN_TEST_VAULT to an open test vault before running live tests.');
  return execFileSync('obsidian', [`vault=${vault}`, ...args], { encoding: 'utf8' });
}
function evaluate(code) {
  const out = call('eval', `code=JSON.stringify(await (async()=>{${code}})())`);
  const match = out.match(/=> (.*)/s); if (!match) throw Error(out); return JSON.parse(match[1]);
}
function cdp(method, params) {
  const out = call('dev:cdp', `method=${method}`, `params=${JSON.stringify(params)}`);
  if (/^Error:/m.test(out)) throw Error(out); return out;
}
function setup(touch = false) {
  return evaluate(`
    const p=app.plugins.plugins['sparse-sort'],v=p.views()[0];
    if(p.conflicted())throw Error('Disable Flexplorer first');
    const folder='SparseSortTest-'+Date.now()+'-'+Math.random().toString(16).slice(2);
    if(app.vault.getAbstractFileByPath(folder))throw Error('Fixture already exists');
    globalThis.__sparseSortFixture={folder,active:app.workspace.activeLeaf,scroll:v.navFileContainerEl.scrollTop,
      editing:p.editing,created:false};
    if(${Boolean(touch)}&&!p.editing)p.toggleEditing();
    await app.vault.createFolder(folder);
    globalThis.__sparseSortFixture.created=true;
    for(const name of ['A.md','B.md','C.md'])await app.vault.create(folder+'/'+name,'Sparse Sort temporary test fixture.');
    for(let i=0;i<40&&!v.fileItems[folder+'/C.md'];i++)await new Promise(resolve=>setTimeout(resolve,50));
    v.revealInFolder(app.vault.getAbstractFileByPath(folder+'/B.md'));
    let mounted=false;
    for(let i=0;i<40;i++){
      await new Promise(resolve=>setTimeout(resolve,50));
      const rows=['A.md','B.md','C.md'].map(name=>v.fileItems[folder+'/'+name]?.selfEl);
      const container=v.navFileContainerEl.getBoundingClientRect();
      if(rows.every(row=>row?.isConnected&&row.getBoundingClientRect().top>=container.top&&row.getBoundingClientRect().bottom<=container.bottom)){mounted=true;break;}
      if(i%5===4){const last=v.getSortedFolderItems(app.vault.getAbstractFileByPath(folder)).at(-1);if(last)v.revealInFolder(last.file);}
    }
    if(!mounted)throw Error('Fixture rows are not visible; open the file explorer and clear its search first.');
    return {folder};
  `);
}
function cleanup() {
  return evaluate(`
    const state=globalThis.__sparseSortFixture;
    if(!state)return {cleaned:false};
    const p=app.plugins.plugins['sparse-sort'],v=p.views()[0];
    const folder=app.vault.getAbstractFileByPath(state.folder);
    if(folder&&state.created)await app.vault.delete(folder,true);
    await p.writer.flush();
    if(p.editing!==state.editing)p.toggleEditing();
    v.navFileContainerEl.scrollTop=state.scroll;
    if(state.active)app.workspace.setActiveLeaf(state.active);
    document.querySelectorAll('.notice').forEach(el=>{if(el.textContent.includes(state.folder))el.remove();});
    delete globalThis.__sparseSortFixture;
    return {cleaned:true,testOrderRemoved:!p.store.data.orders[state.folder]};
  `);
}
module.exports={call,evaluate,cdp,setup,cleanup};
