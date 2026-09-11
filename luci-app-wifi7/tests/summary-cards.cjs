// Real native Map reset and runtime/UCI fixtures. No new transport methods.
const assert=require('assert/strict'),{boot}=require('./mlo-luci-dom.cjs');
(async()=>{
 let cases=0;
 for(const opts of [{},{unknown:true},{iface:{device:['radio0']}},{iface:{device:['radio0','missing']}},{iface:{mlo:'0'}}]){
  const h=await boot(opts);try{
   const check=()=>{const cards=[...h.node.querySelectorAll('.mlo-summary-item')];assert.equal(cards.length,3);for(const c of cards){assert.equal(c.children.length,3);assert([...c.children].every(e=>e.textContent.trim()));}return cards;};
   let c=check();assert.equal(c[2].children[1].textContent,'2');assert.equal(c[2].children[2].textContent,'5g / 6g');
   const incomplete=opts.iface?.device&&opts.iface.device[1]!=='radio1';
   const expected=opts.iface?.mlo==='0'?'Pending addition':incomplete?'1 incomplete':'0 incomplete';
   assert.equal(c[0].children[2].textContent,expected);
   if(opts.unknown)assert.equal(c[1].children[1].textContent,'Unavailable');
   await h.map.reset();check();
   cases++;
  }finally{h.w.close();}
 }
 for(const radios of [{},{radio0:{'.name':'radio0','.type':'wifi-device'}}]){const h=await boot({radios});try{for(let i=0;i<2;i++){const cards=[...h.node.querySelectorAll('.mlo-summary-item')];assert.equal(cards.length,3);assert(cards.every(c=>c.children.length===3));assert.equal(cards[2].children[1].textContent,String(Object.keys(radios).length));assert.equal(cards[2].children[2].textContent,'Unknown');await h.map.reset();}cases++;}finally{h.w.close();}}
 console.log('PASS '+cases+' MLO summary cases: three populated rows/cards; real configured radios/bands, missing radio, incomplete/empty config, runtime unavailable, reset');
})().catch(e=>{console.error(e);process.exitCode=1});
