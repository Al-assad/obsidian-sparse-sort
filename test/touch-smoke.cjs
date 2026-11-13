'use strict';
const { setTimeout }=require('node:timers/promises');
const { evaluate,cdp,setup,cleanup }=require('./live-helper.cjs');
(async()=>{
  try {
    setup(true);
    const points=evaluate(`
      const p=app.plugins.plugins['sparse-sort'],v=p.views()[0],folder=globalThis.__sparseSortFixture.folder;
      if(!p.editing)p.toggleEditing();
      const current=v.getSortedFolderItems(app.vault.getAbstractFileByPath(folder)).map(item=>item.file.name);
      const source=current.at(-1);globalThis.__sparseSortFixture.expected=[source,...current.filter(name=>name!==source)];
      const from=v.fileItems[folder+'/'+source].selfEl.querySelector('.ss-handle').getBoundingClientRect();
      const to=v.fileItems[folder+'/'+current[0]].selfEl.getBoundingClientRect();
      return {from:{x:from.left+from.width/2,y:from.top+from.height/2},to:{x:to.right-30,y:to.top+2}};
    `);
    cdp('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    cdp('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[points.from]});await setTimeout(60);
    cdp('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[points.to]});await setTimeout(80);
    cdp('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await setTimeout(80);
    console.log(JSON.stringify(evaluate(`
      const p=app.plugins.plugins['sparse-sort'],folder=globalThis.__sparseSortFixture.folder;await p.writer.flush();
      const disk=JSON.parse(await app.vault.adapter.read(p.manifest.dir+'/data.json'));
      if(JSON.stringify(disk.orders[folder])!==JSON.stringify(globalThis.__sparseSortFixture.expected))throw Error('Touch was not saved');
      return {touchSaved:true};
    `)));
  } finally {
    cdp('Emulation.setTouchEmulationEnabled',{enabled:false});console.log(JSON.stringify(cleanup()));
  }
})().catch(error=>{console.error(error);process.exitCode=1});
