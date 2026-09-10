'use strict';
// Optional offline Aurora geometry check: exported real LuCI DOM + production
// SVG renderer, fixture history. No router or browser-side RPC validation.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { JSDOM } = require('jsdom');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.env.NPU_LAYOUT_DIR;
const aurora = process.env.AURORA_DIR;
if (!out || !aurora) throw Error('Set NPU_LAYOUT_DIR and AURORA_DIR; export npu.dom.html into NPU_LAYOUT_DIR first');
const source = fs.readFileSync(path.join(__dirname, '../htdocs/luci-static/resources/view/airoha_npu/status.js'), 'utf8');
const exported = fs.readFileSync(path.join(out, 'npu.dom.html'), 'utf8');
const dom = new JSDOM(exported);
const app = dom.window.document.querySelector('.npu-dashboard').outerHTML;
const template = fs.readFileSync(path.join(aurora, 'ucode/template/themes/aurora/header.ut'), 'utf8');
const clean = s => s.replace(/{%[\s\S]*?%}/g, '').replace(/{{ hostname }}/g, 'Fixture router').replace(/{{ media }}/g, '/luci-static/aurora').replace(/{{ logo_svg }}/g, 'logo.svg').replace(/{{ icon_cache_version }}/g, '0').replace(/{{ _\('([^']+)'\) }}/g, '$1');
const header = clean(template.slice(template.indexOf('<header>'), template.indexOf("{% if (nav_type == 'mega-menu'): %}", template.indexOf('<header>')))) + '</header>';
const sidebar = clean(template.slice(template.indexOf('<aside class="sidebar-panel"'), template.indexOf('</aside>') + 8));
const html = '<!doctype html><html lang="' + (process.env.NPU_ZH ? 'zh-Hans' : 'en') + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/luci-static/aurora/main.css"><link rel="stylesheet" href="/luci-static/aurora/fonts/aurora-font.css"></head><body class="' + (process.env.NPU_ZH ? 'lang_zh_Hans' : 'lang_en') + '" data-nav-type="sidebar">' + header + sidebar + '<div id="maincontent"><div id="view">' + app + '</div></div></body></html>';
const renderer = source.slice(source.indexOf('\t\tfunction svgNode('), source.indexOf('\t\tfunction sample(')).replace(/var chart = svgNode\('svg', [^\n]+\);/, "var chart = document.querySelector('.npu-frequency-chart svg');");
(async () => {
 const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
 const results = [];
 try {
  for (const scenario of ['status', 'settings', 'settings-unknown', 'settings-saved', 'settings-noop', 'settings-failed']) for (const width of [320, 390, 768, 1024, 1440]) for (const dark of [false, true]) {
   let pageHTML = html;
   if (scenario !== 'status') {
    const settingsDOM = new JSDOM(fs.readFileSync(path.join(out, scenario.replace('settings-', 'settings.') + '.html'), 'utf8'));
    const d = settingsDOM.window.document;
    pageHTML = html.replace(app, d.querySelector('#maincontent').innerHTML).replace('</head>', [...d.head.querySelectorAll('style')].map(s => s.outerHTML).join('') + '</head>');
    settingsDOM.window.close();
   }
   const page = await browser.newPage({ viewport: { width, height: 1000 } });
   const errors = [];
   page.on('pageerror', e => errors.push(String(e)));
   page.on('requestfailed', r => errors.push(r.url()));
   page.on('response', r => { if (r.status() >= 400) errors.push(r.url() + ': ' + r.status()); });
   await page.route('http://fixture/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: pageHTML });
    return route.fulfill({ path: path.join(aurora, 'htdocs', pathname) });
   });
   await page.goto('http://fixture/', { waitUntil: 'networkidle' });
   if (scenario !== 'status') {
    await page.evaluate(async dark => { document.documentElement.setAttribute('data-darkmode', String(dark)); await document.fonts.ready; }, dark);
    const row = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, controls: [...document.querySelectorAll('.cbi-value')].map(e => { const r = e.getBoundingClientRect(); return { width: r.width, height: r.height, right: r.right }; }), text: document.querySelector('.npu-settings').textContent, buttons: [...document.querySelectorAll('.cbi-page-actions button, .cbi-page-actions .cbi-button-apply, .alert-message button')].map(e => { const r = e.getBoundingClientRect(); return { text: e.textContent, x: r.x, right: r.right, width: r.width, height: r.height }; }), notices: [...document.querySelectorAll('.alert-message')].map(e => ({ text: e.textContent, width: e.getBoundingClientRect().width, right: e.getBoundingClientRect().right })) }));
    assert.equal(errors.length, 0, errors.join('\n'));
    assert(row.documentWidth <= width && row.controls.length === 3 && row.controls.every(r => r.width > 0 && r.height > 0 && r.right <= width), JSON.stringify(row));
    assert(row.buttons.length >= 2 && row.buttons.every(b => b.width > 0 && b.height > 0 && b.x >= 0 && b.right <= width), JSON.stringify(row));
    if (process.env.NPU_ZH) { assert(row.text.includes('调速策略')); assert(row.buttons.some(b => b.text === '保存')); }
    if (['settings-saved', 'settings-noop', 'settings-failed'].includes(scenario)) assert.equal(row.notices.length, 1);
    assert(row.notices.every(n => n.width > 0 && n.right <= width));
    await page.screenshot({ path: path.join(out, `${scenario}-${width}-${dark ? 'dark' : 'light'}.png`), fullPage: true });
    results.push({ scenario, width, dark, ...row, errors });
    await page.close();
    continue;
   }
   await page.evaluate(async ({ dark, renderer }) => {
    document.documentElement.setAttribute('data-darkmode', String(dark));
    await document.fonts.ready;
    // Reuse exported fixture points, not invented readings; run the exact
    // production renderer with the actual browser-measured content width.
    const samples = [...document.querySelectorAll('.npu-chart-point')].map(p => ({ time: +p.dataset.time, value: +p.dataset.mhz }));
    const now = Math.max(...samples.map(p => p.time));
    // renderer comes only from this trusted local package source, never RPC/input.
    new Function('samples', 'ceiling', 'Date', renderer + '\ndrawChart();')(samples, 1200, { now: () => now });
   }, { dark, renderer });
   const row = await page.evaluate(() => {
    const chart = document.querySelector('.npu-frequency-chart'), svg = chart.querySelector('svg');
    const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    const labels = [...svg.querySelectorAll('text')];
    const times = labels.filter(e => / s$/.test(e.textContent));
    return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, chart: rect(chart), svg: rect(svg), viewBox: svg.getAttribute('viewBox'), ticks: times.length,
     labelsContained: labels.every(e => { const r = e.getBoundingClientRect(), s = svg.getBoundingClientRect(); return r.left >= s.left && r.right <= s.right; }),
     timeLabelsSeparated: times.every((e, i) => !i || times[i - 1].getBoundingClientRect().right + 4 < e.getBoundingClientRect().left),
     titleSize: getComputedStyle(chart.querySelector('.npu-chart-header')).fontSize,
     tickSize: getComputedStyle(labels[0]).fontSize, stroke: getComputedStyle(svg.querySelector('.npu-chart-line')).stroke, lineWidth: getComputedStyle(svg.querySelector('.npu-chart-line')).strokeWidth,
     areaOpacity: getComputedStyle(svg.querySelector('.npu-chart-area')).fillOpacity, areaFill: getComputedStyle(svg.querySelector('.npu-chart-area')).fill, text: document.querySelector('.npu-dashboard').textContent, margin: getComputedStyle(chart).margin, points: svg.querySelectorAll('circle').length, rules: [...document.styleSheets].reduce((n, s) => n + s.cssRules.length, 0) };
   });
   assert.equal(errors.length, 0, errors.join('\n'));
   assert(row.rules > 100 && row.points === 41, 'actual Aurora and application content');
   assert(row.documentWidth <= width, JSON.stringify(row));
   assert(row.labelsContained && row.timeLabelsSeparated, JSON.stringify(row));
   assert.equal(+row.viewBox.split(' ')[2], Math.round(row.svg.width));
   assert.equal(row.lineWidth, '1.5px');
   assert.equal(row.tickSize, '12px');
   assert.equal(row.areaOpacity, '0.1');
   assert.equal(row.areaFill, 'rgb(34, 160, 107)');
   if (process.env.NPU_ZH) assert(row.text.includes('调速策略'));
   assert.equal(row.stroke, 'rgb(34, 160, 107)');
   await page.screenshot({ path: path.join(out, `npu-${width}-${dark ? 'dark' : 'light'}.png`), fullPage: true });
   results.push({ scenario, width, dark, ...row, errors });
   await page.close();
  }
  fs.writeFileSync(path.join(out, 'layout-results.json'), JSON.stringify(results, null, 2));
  const crypto = require('crypto');
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ source: crypto.createHash('sha256').update(source).digest('hex'), dom: crypto.createHash('sha256').update(exported).digest('hex'), inputs: Object.fromEntries([path.join(__dirname, '../htdocs/luci-static/resources/view/airoha_npu/settings.js'), path.join(__dirname, '../po/zh_Hans/luci-app-airoha-npu.po'), path.join(aurora, 'htdocs/luci-static/aurora/main.css'), ...fs.readdirSync(out).filter(n => n.endsWith('.html')).map(n => path.join(out, n))].map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')])) }, null, 2));
  console.log('PASS Aurora Chromium geometry: ' + results.length + ' viewport/theme pairs');
  console.log(JSON.stringify(results));
 } finally { await browser.close(); dom.window.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
