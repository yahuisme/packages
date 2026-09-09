const assert=require('assert/strict');const h=require('./harness.js');
(async()=>{
 const node=await h.app.render(await h.app.load());h.document.body.append(node);await h.tick();
 assert(node.textContent.includes('36 / 80 MHz'));assert(node.textContent.includes('25 dBm'),'radio info works without interfaces');
 const tabs=node.querySelectorAll('.cbi-tabmenu a');let loads=0,pauses=0,resolve;
 h.mloView.load=()=>{loads++;return loads===1?Promise.reject(Error('temporary')):new Promise(r=>resolve=r)};
 h.mloView.pause=()=>pauses++;
 tabs[2].dispatchEvent(new h.dom.window.MouseEvent('click', {bubbles:true,cancelable:true}));await h.tick();assert(node.textContent.includes('MLO configuration is unavailable'));
 tabs[0].dispatchEvent(new h.dom.window.MouseEvent('click', {bubbles:true,cancelable:true}));tabs[2].dispatchEvent(new h.dom.window.MouseEvent('click', {bubbles:true,cancelable:true}));tabs[2].dispatchEvent(new h.dom.window.MouseEvent('click', {bubbles:true,cancelable:true}));assert.equal(loads,2,'retry allowed but no duplicate loading');
 tabs[0].dispatchEvent(new h.dom.window.MouseEvent('click', {bubbles:true,cancelable:true}));resolve([]);await h.tick();assert(node.querySelector('[data-wifi7-pane=mlo]').textContent.includes('MLO fixture'));assert.equal(pauses,1,'late MLO render paused on hidden tab');
 let release;h.network.flushCache=()=>new Promise(r=>release=r);const pending=h.poll();node.remove();await h.tick();const html=node.innerHTML;release();await pending;assert.equal(node.innerHTML,html,'late telemetry does not mutate detached root');
 console.log('PASS empty-interface iwinfo, retry/single-flight/hidden MLO, detached telemetry');h.dom.window.close();
})().catch(e=>{console.error(e);process.exitCode=1});
