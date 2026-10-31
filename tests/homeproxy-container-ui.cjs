'use strict';
const assert=require('assert/strict');
const {pageBoot}=require('./helpers/test_page_lifecycle.cjs');
(async()=>{
 for(const name of ['node','client']){
  const h=await pageBoot(name);
  try {
   for(let i=0;i<2;i++){
    const css=[...h.w.document.querySelectorAll('#view style')].map(s=>s.textContent).join('');
    assert(css.includes('@container hp-form (max-width:600px)'),name+': section content-width breakpoint');
    assert(css.includes('container-name:hp-form'),name+': section-local named container');
    assert(css.includes('.cbi-value-title')&&css.includes('text-align:left'),name+': narrow labels stack left');
    assert(!/#cbi-homeproxy-(?:config|subscription)[^{}]*\.cbi-value\{display:block\}/.test(css),name+': container layout must not override inactive field hiding');
    await h.map.reset();
   }
  }finally{h.w.close();}
 }
 console.log('PASS: native node/client section-local container styles survive Map.reset (geometry requires browser)');
})().catch(e=>{console.error(e);process.exitCode=1;});
