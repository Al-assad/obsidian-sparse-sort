'use strict';
const { call,evaluate,setup,cleanup }=require('./live-helper.cjs');
try {
  setup();
  console.log(JSON.stringify(evaluate(`
    const p=app.plugins.plugins['sparse-sort'],v=p.views()[0],folder=globalThis.__sparseSortFixture.folder;
    const check=(value,message)=>{if(!value)throw Error(message)};
    const current=v.getSortedFolderItems(app.vault.getAbstractFileByPath(folder)).map(item=>item.file.name);
    const from=current.at(-1),to=current[0],expected=[from,...current.filter(name=>name!==from)];
    globalThis.__sparseSortFixture.expected=expected;
    const source=v.fileItems[folder+'/'+from].selfEl,target=v.fileItems[folder+'/'+to].selfEl;
    const original=p.patches.get(Object.getPrototypeOf(v)).original,root=app.vault.getAbstractFileByPath(folder);
    check(JSON.stringify(v.getSortedFolderItems(root).map(i=>i.file.path))===JSON.stringify(original.call(v,root).map(i=>i.file.path)),'Native fallback changed');
    const r=target.getBoundingClientRect(),x=r.left+60,y=r.top+2;
    check(source.isConnected&&target.isConnected,'Fixture is not visible');
    const transfer=new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));
    target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,clientX:x,clientY:y,dataTransfer:transfer}));
    const drop=new DragEvent('drop',{bubbles:true,cancelable:true,clientX:x,clientY:y,dataTransfer:transfer});
    target.dispatchEvent(drop);app.dragManager.onDragEnd();
    await p.writer.flush();
    check(drop.defaultPrevented,'Native move was not intercepted');
    const disk=JSON.parse(await app.vault.adapter.read(p.manifest.dir+'/data.json'));
    check(JSON.stringify(disk.orders[folder])===JSON.stringify(expected),'Drag was not saved');
    check(app.vault.getAbstractFileByPath(folder+'/'+from).parent.path===folder,'Drag moved a file');
    return {dragSaved:true,noFileMove:true,nativeFallback:true};
  `)));
  call('plugin:reload','id=sparse-sort');
  console.log(JSON.stringify(evaluate(`
    const p=app.plugins.plugins['sparse-sort'],folder=globalThis.__sparseSortFixture.folder;
    if(JSON.stringify(p.store.data.orders[folder])!==JSON.stringify(globalThis.__sparseSortFixture.expected))throw Error('Reload lost saved order');
    return {reloadPreservedOrder:true,bindings:p.bindings.size};
  `)));
} finally { console.log(JSON.stringify(cleanup())); }
