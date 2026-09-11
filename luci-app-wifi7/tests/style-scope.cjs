const assert=require('assert/strict');const {boot}=require('./integration.cjs');
(async()=>{const h=await boot();try{
 const sheet=h.q('.wifi7-map style').sheet;
 function check(rules){for(const r of rules){if(r.selectorText)for(const selector of r.selectorText.split(','))assert(selector.trim().startsWith('.wifi7-map '),'root scope: '+selector);if(r.cssRules)check(r.cssRules)}}
 check(sheet.cssRules);
 assert.equal(h.w.getComputedStyle(h.q('.wifi7-settings-card .cbi-value')).marginTop,'0px','compact app field spacing');
 const sibling=h.w.document.createElement('div');sibling.className='wifi7-card';h.w.document.body.append(sibling);
 assert.notEqual(h.w.getComputedStyle(sibling).padding,'16px','unrelated same-name class untouched');
 console.log('PASS all WiFi selectors root-scoped, including media/groups and unrelated sibling');
}finally{h.w.close()}})().catch(e=>{console.error(e);process.exitCode=1});
