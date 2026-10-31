// CSS contract only; browser geometry is verified by the parent agent.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const files={npu:'luci-app-airoha-npu/htdocs/luci-static/resources/view/airoha_npu/settings.js',flowsense:'luci-app-airoha-flowsense/htdocs/luci-static/resources/view/airoha_flowsense/settings.js',fan:'luci-app-airoha-fancontrol/htdocs/luci-static/resources/view/fan/settings.js',wifi:'luci-app-wifi7/htdocs/luci-static/resources/view/wifi7/index.js'};
for(const [name,file] of Object.entries(files)){
 const source=fs.readFileSync(path.join(__dirname,'../..',file),'utf8');
 assert.match(source,/container-type:inline-size/,name+' has local container');
 assert.match(source,/@container\s*\(max-width:\s*600px\)/,name+' uses actual content width');
 assert.match(source,/text-align:start/,name+' left-aligns stacked labels');
 assert.match(source,/flex:(?:0 0 )?auto|flex:none/,name+' clears desktop basis');
}
console.log('PASS four scoped narrow-container CSS contracts; geometry requires browser');
