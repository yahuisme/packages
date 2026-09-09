const fs=require('fs'),assert=require('assert'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<body></body>');
const document=dom.window.document;
const window=dom.window;
window.getComputedStyle = () => ({ getPropertyValue: () => '' });
dom.window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {}, set: () => true });
class MockObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}
function E(t,a={},cs=[]){let n=document.createElement(t);Object.entries(a).forEach(([k,v])=>typeof v==='function'?n.addEventListener(k,v):n.setAttribute(k,v));(Array.isArray(cs)?cs:[cs]).forEach(c=>n.append(c));return n;}
let frame,tick,removed=false,fail=false,detailCalls=0;
const data={timestamp:1000,uptime:100,configured_hw:null,configured_sw:true,monitor:{target:'example.com',enabled:true},jitter:{last_ping:12,deviation:0,loss:0,received:10,samples:10},interfaces:[],ppe:{available:false}};
// Synthetic fixtures: actual page behavior without network or hardware calls.
const source=fs.readFileSync(require('path').join(__dirname,'../htdocs/luci-static/resources/view/airoha_flowsense/status.js'),'utf8');
const app=new Function('view','rpc','poll','ui','document','window','ResizeObserver','MutationObserver','E','_','requestAnimationFrame',source)({extend:x=>x},{declare:s=>()=>{if(fail)return Promise.reject(Error('offline'));if(s.method==='getPpeEntries'){detailCalls++;return Promise.resolve({available:true,total:0,entries:[]})}return Promise.resolve(data)}},{add:f=>tick=f,remove:f=>{if(f===tick)removed=true;}},{},document,window,MockObserver,MockObserver,E,x=>x,f=>frame=f);
const card = (id, part='value') => document.querySelector('#fs-summary-' + id + ' .fs-card-' + part).textContent;
const port = (device, rx, tx) => ({device,ifindex:device==='wan'?1:2,carrier:true,speed:1000,stats:{rx_bytes:rx,tx_bytes:tx}});
async function sample(ports) { data.uptime += 10; data.interfaces=ports; await tick(); }
async function regression() {
	await sample([port('wan',0,0),port('lan2',0,0)]);
	await sample([port('wan',125000000,0),port('lan2',0,125000000)]);
	assert.equal(card('rx','title'),'Total Port Receive Rate');
	assert.equal(card('tx','title'),'Total Port Transmit Rate');
	assert.equal(card('rx'),'100 Mbit/s');
	assert.equal(card('tx'),'100 Mbit/s');
	for (const direction of ['rx','tx']) {
		for (const missing of ['partial','all']) {
			await sample([port('wan',0,0),port('lan2',0,0)]);
			const ports=[port('wan',125000000,125000000),port('lan2',125000000,125000000)];
			ports[0].stats[direction+'_bytes']=null;
			if (missing==='all') ports[1].stats[direction+'_bytes']=null;
			await sample(ports);
			assert.equal(card(direction),'—',direction+' '+missing+' missing');
			assert.equal(card(direction==='rx'?'tx':'rx'),'200 Mbit/s');
		}
	}
	await sample([]); assert.equal(card('rx'),'—'); assert.equal(card('tx'),'—');
	await sample([port('wan',100,100)]);
	await sample([port('wan',0,200)]);
	assert.equal(card('rx'),'—','reset is not a full total');
	assert.notEqual(card('tx'),'—');
	data.jitter={last_ping:12,loss:null,deviation:null,received:0,samples:0}; await tick();
	assert.equal(card('quality','sub'),'Loss: —');
	assert.equal(card('ppe','sub'),'PPE data unavailable');
	data.jitter=null; await tick();
	assert.equal(card('quality','sub'),'Probe data unavailable');
	data.monitor.enabled=false; await tick(); assert.equal(card('quality','sub'),'Probe disabled');
	delete data.monitor.enabled; await tick(); assert.equal(card('quality','sub'),'Unknown');
	delete data.monitor; await tick(); assert.equal(card('quality','sub'),'Unknown');
	data.monitor={enabled:true,target:'example.com'};
	for (const [carrier,label,cls] of [[1,'Up','fs-badge-up'],[0,'Down','fs-badge-down'],[null,'Unknown',null],[true,'Up','fs-badge-up'],[false,'Down','fs-badge-down']]) {
		const p=port('wan',0,0); p.carrier=carrier; await sample([p]);
		const badge=document.querySelector('.fs-iface-badge');
		assert.equal(badge.textContent,label,'carrier '+carrier);
		assert.equal(badge.classList.contains('fs-badge-up'),cls==='fs-badge-up');
		assert.equal(badge.classList.contains('fs-badge-down'),cls==='fs-badge-down');
	}
	console.log('PASS: real producer carrier 1/0/null and boolean compatibility preserve status classes');
	console.log('PASS: unavailable PPE; enabled, disabled and unknown probe states');
	console.log('PASS: null loss remains unknown');
	console.log('PASS: independent RX/TX validity, partial/all missing, empty ports and reset');
	console.log('PASS: one-way WAN to LAN counts as port RX and TX, not Internet download/upload');
}
(async()=>{document.body.append(app.render());frame();await new Promise(r=>setImmediate(r));assert.equal(detailCalls,0);assert(document.body.textContent.includes('0 ms'));assert(document.body.textContent.includes('Unknown'));assert(tick() instanceof Promise);await tick();document.querySelectorAll('a')[1].click();await new Promise(r=>setImmediate(r));assert.equal(detailCalls,1);[...document.querySelectorAll('button')].find(b=>b.textContent==='Pause').click();await tick();assert.equal(detailCalls,1);await regression();fail=true;await tick();assert(!document.body.textContent.includes('12 ms'));assert(document.body.textContent.includes('previous readings cleared'));console.log('DOM PASS: zero deviation, unknown state, Promise polling, on-demand/pause, stale clearing')})().catch(e=>{console.error(e);process.exit(1)});
