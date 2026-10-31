'use strict';
const assert=require('assert/strict');
const {pageBoot}=require('./helpers/test_page_lifecycle.cjs');
const {walk,FEATURES}=require('./homeproxy-editor-parity.cjs');
(async()=>{
 const h=await pageBoot('server',{'Expecting: %s':'请输入：%s','non-empty value':'非空值','valid email address':'有效的电子邮箱地址'});
 try {
  h.root().remove();h.w.document.querySelector('#view').append(await h.app.render(['homeproxy',FEATURES]));
  h.map=h.mods.dom.findClassInstance(h.root());
  const section=walk(h.map).find(o=>o.option==='type'&&o.section.sectiontype==='server').section;
  await section.renderMoreOptionsModal('s1');
  const map=h.mods.dom.findClassInstance(section.getActiveModalMap());
  const email=walk(map).find(o=>o.option==='tls_acme_email');
  assert.equal(email.validate('s1',''),'请输入：非空值');
  assert.equal(email.validate('s1','bad'),'请输入：有效的电子邮箱地址');
  assert.equal(email.validate('s1','test@example.com'),true);
  console.log('PASS: native ACME modal email validators localize both interpolated errors');
 }finally{h.w.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
