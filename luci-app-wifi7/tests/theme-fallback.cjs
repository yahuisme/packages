const fs=require('fs'),assert=require('assert/strict'),{chromium}=require('playwright');
const {boot}=require('./integration.cjs'),{boot:mlo}=require('./mlo-luci-dom.cjs');
(async()=>{
 const aur=process.env.AURORA_HTDOCS;
 assert.ok(aur,'set AURORA_HTDOCS to original Aurora htdocs');
 const h=await boot(),m=await mlo();
 const html=h.j.serialize().replace('</body>',m.node.outerHTML+'</body>');h.w.close();m.w.close();
 const b=await chromium.launch({headless:true,args:['--no-sandbox']}),results=[];
 try {for(const dark of [false,true])for(const width of [390,768,1440]) {
  const p=await b.newPage({viewport:{width,height:1000}});
  await p.route('http://wifi7.test/**',r=>r.fulfill({path:aur+new URL(r.request().url()).pathname}));
  await p.setContent(html);await p.addStyleTag({content:fs.readFileSync(aur+'/luci-static/aurora/main.css','utf8')});
  await p.evaluate(d=>document.documentElement.dataset.darkmode=String(d),dark);
  const result=await p.evaluate(()=>{
   const cs=s=>getComputedStyle(document.querySelector(s));
   const ref=document.createElement('div');ref.style.cssText='border:1px solid var(--hairline);color:var(--text-muted)';document.body.append(ref);
   const r={expectedBorder:getComputedStyle(ref).borderTopColor,expectedMuted:getComputedStyle(ref).color,border:cs('.wifi7-card').borderTopColor,muted:cs('.wifi7-label').color,mloBorder:cs('.mlo-summary-item').borderTopColor,mloMuted:cs('.mlo-summary-label').color,green:cs('.wifi7-badge-up > span').color,overflow:document.documentElement.scrollWidth>innerWidth};ref.remove();return r;
  });results.push({dark,width,...result});
  assert.equal(result.border,result.expectedBorder);assert.equal(result.mloBorder,result.expectedBorder);
  assert.equal(result.muted,result.expectedMuted);assert.equal(result.mloMuted,result.expectedMuted);
  assert.equal(result.green,'rgb(22, 163, 74)');assert.equal(result.overflow,false);
  await p.close();
 }} finally {await b.close();if(process.env.THEME_OUT)fs.writeFileSync(process.env.THEME_OUT,JSON.stringify(results,null,2));}
 console.log('PASS Aurora fallback: '+results.length+' light/dark responsive renders');
})().catch(e=>{console.error(e);process.exitCode=1});
