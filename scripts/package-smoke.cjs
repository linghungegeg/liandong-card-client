const {app}=require('electron');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const packageRoot=process.env.LIANDONG_PACKAGE_ROOT
  ? path.resolve(process.env.LIANDONG_PACKAGE_ROOT)
  : path.resolve(__dirname,'../release/0.1.0/LiandongCard-win32-x64');
const {boot}=require(path.join(packageRoot,'resources/app.asar/electron/main.cjs'));
app.whenReady().then(async()=>{
  const {main,store,stock}=await boot();stock.stop();
  try{
    const runtimeErrors=[];
    main.webContents.on('console-message',(_event,level,message)=>{
      if(level===3) runtimeErrors.push(message);
    });
    assert.ok(main.webContents.getURL().includes('app.asar/dist/index.html'));
    const snapshot=await main.webContents.executeJavaScript('window.liandong.snapshot()');
    assert.equal(snapshot.accounts.length,0);
    const ui=await main.webContents.executeJavaScript('Array.from(document.querySelectorAll("aside button")).map(b=>b.textContent.trim())');
    assert.equal(ui.length,8);assert.equal(ui[0],'仪表盘');
    const result=await main.webContents.executeJavaScript('window.liandong.addAccount({label:"包内IPC验收"})');
    assert.ok(result.id);assert.equal(store.snapshot().accounts.length,1);
    await main.webContents.executeJavaScript('Array.from(document.querySelectorAll("aside button")).find(b=>b.textContent.trim()==="账号管理").click()');
    await new Promise(r=>setTimeout(r,300));
    await main.webContents.executeJavaScript('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="添加账号").click()');
    await new Promise(r=>setTimeout(r,300));
    await main.webContents.executeJavaScript('(()=>{const input=document.querySelector(".arco-modal input");const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;setter.call(input,"消息兼容验收");input.dispatchEvent(new Event("input",{bubbles:true}))})()');
    await main.webContents.executeJavaScript('document.querySelector(".arco-modal .arco-btn-primary").click()');
    let successMessage=false;
    for(let i=0;i<30;i++){
      successMessage=await main.webContents.executeJavaScript('Array.from(document.querySelectorAll(".arco-message")).some(e=>e.textContent.includes("账号已添加"))');
      if(successMessage) break;
      await new Promise(r=>setTimeout(r,100));
    }
    assert.ok(successMessage,'新增账号后的成功提示必须正常渲染');
    assert.equal(store.snapshot().accounts.length,2);
    assert.ok(!runtimeErrors.some(e=>/CopyReactDOM\.render|unmountComponentAtNode.*function/.test(e)),runtimeErrors.join('\n'));
    assert.equal(await main.webContents.executeJavaScript('Array.from(document.querySelectorAll("header button")).filter(b=>b.textContent.includes("打开官网")).length'),0);
    const dir=app.getPath('userData');const screenshot=await main.webContents.capturePage();
    fs.writeFileSync(path.join(dir,'package-startup.png'),screenshot.toPNG());
    fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({packageRoot,url:main.webContents.getURL(),startup:true,cleanAccountState:true,preloadIPC:true,eightColumns:true,successMessage:true,headerOfficialButtonRemoved:true,time:new Date().toISOString()},null,2));
    console.log('PACKAGE SMOKE PASSED: ASAR frontend, SQLite, preload IPC and eight columns');
    app.exit(0);
  }catch(e){console.error('PACKAGE SMOKE FAILED',e.stack);app.exit(1)}
});
