const {app}=require('electron');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const packageRoot=path.resolve(__dirname,'../release/0.1.0/LiandongCard-win32-x64');
const {boot}=require(path.join(packageRoot,'resources/app.asar/electron/main.cjs'));
app.whenReady().then(async()=>{
  const {main,store,stock}=await boot();stock.stop();
  try{
    assert.ok(main.webContents.getURL().includes('app.asar/dist/index.html'));
    const snapshot=await main.webContents.executeJavaScript('window.liandong.snapshot()');
    assert.equal(snapshot.accounts.length,0);
    const ui=await main.webContents.executeJavaScript('Array.from(document.querySelectorAll("aside button")).map(b=>b.textContent.trim())');
    assert.equal(ui.length,8);assert.equal(ui[0],'仪表盘');
    const result=await main.webContents.executeJavaScript('window.liandong.addAccount({label:"包内IPC验收"})');
    assert.ok(result.id);assert.equal(store.snapshot().accounts.length,1);
    const dir=app.getPath('userData');const screenshot=await main.webContents.capturePage();
    fs.writeFileSync(path.join(dir,'package-startup.png'),screenshot.toPNG());
    fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({packageRoot,url:main.webContents.getURL(),startup:true,cleanAccountState:true,preloadIPC:true,eightColumns:true,time:new Date().toISOString()},null,2));
    console.log('PACKAGE SMOKE PASSED: ASAR frontend, SQLite, preload IPC and eight columns');
    app.exit(0);
  }catch(e){console.error('PACKAGE SMOKE FAILED',e.stack);app.exit(1)}
});
