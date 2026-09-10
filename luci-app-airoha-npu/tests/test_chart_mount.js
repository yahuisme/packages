'use strict';
// Real Chromium geometry, production render/lifecycle + LuCI DOM and Aurora CSS.
// Only transport, top-level LuCI bootstrap and interval scheduling are fixtures.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.env.LUCI_RESOURCE_DIR, aurora = process.env.AURORA_DIR;
const out = process.env.NPU_LAYOUT_DIR;
if (!root || !aurora || !out) throw Error('Set LUCI_RESOURCE_DIR, AURORA_DIR and NPU_LAYOUT_DIR');
fs.mkdirSync(out, { recursive: true });
const source = fs.readFileSync(path.join(__dirname, '../htdocs/luci-static/resources/view/airoha_npu/status.js'), 'utf8');
const luci = fs.readFileSync(path.join(root, 'luci.js'), 'utf8').replace('window.LuCI = LuCI;', 'window.LuCI = LuCI; window.__classes = classes; window.__env = env;');
const template = fs.readFileSync(path.join(aurora, 'ucode/template/themes/aurora/header.ut'), 'utf8');
const clean = s => s.replace(/{%[\s\S]*?%}/g, '').replace(/{{ hostname }}/g, 'Fixture router').replace(/{{ media }}/g, '/luci-static/aurora').replace(/{{ logo_svg }}/g, 'logo.svg').replace(/{{ icon_cache_version }}/g, '0').replace(/{{ _\('([^']+)'\) }}/g, '$1');
const header = clean(template.slice(template.indexOf('<header>'), template.indexOf("{% if (nav_type == 'mega-menu'): %}", template.indexOf('<header>')))) + '</header>';
const sidebar = clean(template.slice(template.indexOf('<aside class="sidebar-panel"'), template.indexOf('</aside>') + 8));
const results = [];
(async () => {
 const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
 try {
  for (const noRO of [false, true]) for (const width of [1440, 768, 390]) {
   const page = await browser.newPage({ viewport: { width, height: 1000 } });
   const errors = [];
   page.on('pageerror', e => errors.push(String(e)));
   page.on('requestfailed', r => errors.push(r.url()));
   await page.route('http://fixture/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    return pathname === '/' ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/luci-static/aurora/main.css"><link rel="stylesheet" href="/luci-static/aurora/fonts/aurora-font.css"></head><body data-nav-type="sidebar">' + header + sidebar + '<div id="maincontent"><div id="view"></div></div></body></html>' }) : route.fulfill({ path: path.join(aurora, 'htdocs', pathname) });
   });
   await page.goto('http://fixture/');
   await page.evaluate(async () => { await document.fonts.ready; });
   await page.evaluate(({ luci, source, noRO }) => {
    // Evaluate only trusted local LuCI/package sources, never RPC/input text.
    eval(luci);
    const mods = window.__classes;
    window.L = Object.create(window.LuCI.prototype);
    window._ = s => s;
    window.E = mods.dom.create.bind(mods.dom);
    window.timers = new Map(); let next = 0;
    window.setInterval = fn => { timers.set(++next, fn); return next; };
    window.clearInterval = id => timers.delete(id);
    window.queue = new Set();
    if (noRO) window.ResizeObserver = undefined;
    window.app = new (new Function('view', 'rpc', 'poll', source)(mods.view.extend({ __init__() {} }), { declare: () => () => Promise.resolve({}) }, { add: fn => queue.add(fn), remove: fn => queue.delete(fn) }))();
    window.measure = stage => {
     const svg = document.querySelector('.npu-frequency-chart svg'), box = svg.getBoundingClientRect(), m = svg.getScreenCTM();
     return { stage, width: box.width, viewBox: svg.viewBox.baseVal.width, scaleX: m.a, scaleY: m.d, inset: m.e - box.x, points: svg.querySelectorAll('circle').length, stroke: getComputedStyle(svg.querySelector('.npu-chart-line')).stroke, lineWidth: getComputedStyle(svg.querySelector('.npu-chart-line')).strokeWidth };
    };
    window.mount = () => {
     window.node = app.render([{ soc_compat: 'airoha,fixture' }, { cpu_cur_freq: 600000, cpu_max_freq: 1200000 }, { enabled: true }]);
     document.getElementById('view').replaceChildren(node);
     return measure('synchronous-mount');
    };
   }, { luci, source, noRO });
   for (let entry = 0; entry < 2; entry++) {
    const { immediate, frames } = await page.evaluate(async () => {
     const immediate = mount();
     const rows = [];
     for (let i = 0; i < 3; i++) { await new Promise(requestAnimationFrame); rows.push(measure('frame-' + i)); }
     return { immediate, frames: rows };
    });
    results.push({ width, noRO, entry, immediate, frames });
    fs.writeFileSync(path.join(out, 'mount-results.json'), JSON.stringify(results, null, 2));
    await page.screenshot({ path: path.join(out, `mount-${width}-${noRO}-${entry}.png`), fullPage: true });
    assert(Math.abs(immediate.inset) < 1, 'fallback must not letterbox: ' + JSON.stringify(immediate));
    for (const row of frames) {
     assert(Math.abs(row.viewBox - row.width) <= 1 && Math.abs(row.inset) < 1, 'first frame must use mounted width: ' + JSON.stringify(row));
     assert.equal(row.points, 1); assert.equal(row.stroke, 'rgb(34, 160, 107)'); assert.equal(row.lineWidth, '1.5px');
    }
    // Container-only resize (sidebar/layout), without a window resize event.
    if (!noRO) {
     await page.evaluate(() => { document.getElementById('view').style.width = '80%'; });
     await page.evaluate(async () => { for (let i=0;i<3;i++) await new Promise(requestAnimationFrame); });
     const resized = await page.evaluate(() => measure('container-resize'));
     results.push({ width, noRO, entry, resized });
     assert(Math.abs(resized.width - resized.viewBox) <= 1, JSON.stringify(resized));
    }
    await page.setViewportSize({ width: width === 390 ? 1200 : 390, height: 1000 });
    await page.evaluate(async () => { for (let i=0;i<3;i++) await new Promise(requestAnimationFrame); });
    const resized = await page.evaluate(() => measure('viewport-resize'));
    results.push({ width, noRO, entry, resized });
    assert(Math.abs(resized.width - resized.viewBox) <= 1, JSON.stringify(resized));
    const cleanup = await page.evaluate(async entry => {
     const svg = node.querySelector('svg');
     if (entry) dispatchEvent(new Event('pagehide')); else node.remove();
     await Promise.resolve(); const before = svg.outerHTML;
     dispatchEvent(new Event('resize')); await new Promise(requestAnimationFrame);
     return { timers: timers.size, polls: queue.size, unchanged: before === svg.outerHTML };
    }, entry);
    assert.deepEqual(cleanup, { timers: 0, polls: 0, unchanged: true });
    await page.evaluate(() => { document.getElementById('view').style.width = ''; });
    await page.setViewportSize({ width, height: 1000 });
   }
   assert.deepEqual(errors, []); await page.close();
  }
  console.log('PASS Chromium Aurora: first frames, re-entry, container/viewport resize, ResizeObserver fallback and teardown');
 } finally {
  fs.writeFileSync(path.join(out, 'mount-results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(out, 'mount-manifest.json'), JSON.stringify(Object.fromEntries([['status.js', source], ['luci.js', luci], ['main.css', fs.readFileSync(path.join(aurora, 'htdocs/luci-static/aurora/main.css'))]].map(([n, s]) => [n, require('crypto').createHash('sha256').update(s).digest('hex')])), null, 2));
  await browser.close();
 }
})().catch(e => { console.error(e); process.exitCode = 1; });
