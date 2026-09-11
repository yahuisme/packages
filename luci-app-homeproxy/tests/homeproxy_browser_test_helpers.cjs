const fs=require('fs'),path=require('path'),http=require('http');

function translations(appdir) {
 const tr={};
 const decode=m=>m[1].trim().split('\n').map(JSON.parse).join('');
 for(const file of [path.resolve(process.env.LUCI_RESOURCE_DIR,'../../../po/zh_Hans/base.po'),path.join(appdir,'po/zh_Hans/homeproxy.po')]) {
  for(const block of fs.readFileSync(file,'utf8').split(/\n\s*\n/)) {
   const a=block.match(/^msgid ((?:"[^\n]*"\n?)+)/m),b=block.match(/^msgstr ((?:"[^\n]*"\n?)+)/m);
   if(a&&b&&decode(a)&&decode(b))tr[decode(a)]=decode(b);
  }
 }
 return tr;
}

function serve(snapshots,aurora) {
 return http.createServer((req,res)=>{
  if(req.url.startsWith('/luci-static/aurora/')) {
   try {
    const p=path.join(aurora,req.url);
    res.setHeader('Content-Type',p.endsWith('.css')?'text/css':'application/octet-stream');
    res.end(fs.readFileSync(p));
   } catch {
    res.statusCode=404;res.end();
   }
   return;
  }
  const html=snapshots[decodeURIComponent(req.url.slice(1))];
  if(!html){res.statusCode=404;res.end();return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(html.replace('</head>','<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/luci-static/aurora/main.css"><link rel="stylesheet" href="/luci-static/aurora/fonts/aurora-font.css"></head>'));
 });
}

module.exports={translations,serve};
