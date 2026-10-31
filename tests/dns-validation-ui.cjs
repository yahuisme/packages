'use strict';
const assert=require('assert/strict');
const {pageBoot}=require('./helpers/test_page_lifecycle.cjs');
(async()=>{
 const h=await pageBoot('client',{'Expecting: %s':'请输入：%s','valid DNS server address':'有效的 DNS 服务器地址'});
 try {
  for(const name of ['dns_server','china_dns_server']){
   const o=h.map.lookupOption(name,'config')[0];
   for(const value of ['ftp://dns.example.com','https://user:secret@dns.example.com/dns-query','udp://@1.1.1.1','https://dns.example.com/dns-query#fragment','tcp://1.1.1.1/path','tls://dns.example.com?ignored=yes'])
    assert.equal(o.validate('config',value),'请输入：有效的 DNS 服务器地址',name+': '+value);
   for(const value of ['wan','1.1.1.1','2001:4860:4860::8888','udp://1.1.1.1:53','tcp://1.1.1.1','tls://dns.example.com','quic://dns.example.com','https://dns.example.com/dns-query','h3://dns.example.com/dns-query'])
    assert.equal(o.validate('config',value),true,name+': '+value);
  }
  console.log('PASS: both native DNS fields reject unsupported/ignored URL parts with Chinese errors, preserve supported transports/IP/WAN');
 }finally{h.w.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
