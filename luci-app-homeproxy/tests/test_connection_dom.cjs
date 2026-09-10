const fs=require('fs'),assert=require('assert/strict'),{JSDOM}=require('jsdom');
const j=new JSDOM('<div class="homeproxy-status"></div>',{runScripts:'outside-only'}),w=j.window;
w.eval(fs.readFileSync(process.env.LUCI_RESOURCE_DIR+'/luci.js','utf8').replace(/window\.LuCI\s*=\s*LuCI;/,'window.LuCI = LuCI; window.mods=classes;'));
const dom=w.mods.dom;w.E=(tag,attrs,children)=>dom.create(tag,w.Object.assign(new w.Object(),attrs||{}),Array.isArray(children)?w.Array.from(children):children);w._=s=>({'Connection':'连接','Success':'成功','Failed':'失败','Testing...':'测试中','%s ms':'%s 毫秒'}[s]||s);
w.L={resolveDefault:(p,d)=>p.catch(()=>d)};w.setTimeout=()=>1;w.clearTimeout=()=>{};
w.cbi_update_table=(table,rows)=>rows.forEach(row=>table.append(w.E('tr',{},w.Array.from(row,c=>w.E('td',{},w.Array.of(c))))));
let payload,resolve;const rpc={declare:()=>()=>new Promise(r=>resolve=r)};
const ui={createHandlerFn:(_ctx,fn)=>fn};
let s=fs.readFileSync(__dirname+'/../htdocs/luci-static/resources/view/homeproxy/status.js','utf8');s=s.slice(0,s.indexOf('const resources ='))+'\nreturn {getConnectionStatus,css};';
const api=w.Function('dom','rpc','ui',s)(dom,rpc,ui),root=w.document.querySelector('.homeproxy-status');root.append(w.E('style',{},[api.css]),api.getConnectionStatus.call({connectionSession:{active:true,root,running:false,results:null}}));
const state=()=>root.querySelectorAll('tr')[1].children[2].firstChild,latency=()=>root.querySelectorAll('tr')[1].children[3].textContent;
(async()=>{try{
 assert(root.textContent.includes('连接'));assert(!state().classList.contains('hp-connection-success'));
 const button=root.querySelector('button');
 for(const [result,ms,expected,green]of [[true,0,'0 ms',true],[true,18,'18 ms',true],[true,null,'-',true],[false,18,'-',false],[null,null,'-',false],['true',18,'-',false]]){
  button.click();assert(!state().classList.contains('hp-connection-success'),'testing clears green');
  await new Promise(r=>setImmediate(r));resolve({results:[{site:'baidu',result,latency_ms:ms}]});await new Promise(r=>setImmediate(r));
  assert.equal(latency(),expected);assert.equal(state().classList.contains('hp-connection-success'),green);
  if(green)assert.equal(w.getComputedStyle(state()).color,'rgb(22, 128, 60)');
 }
 console.log('PASS scoped connection success green, unknown/testing not green, 0/18 ms and missing latency');
}finally{w.close();}})().catch(e=>{console.error(e);process.exitCode=1});
