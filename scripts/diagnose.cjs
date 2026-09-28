/* Diagnostic: what is actually on screen at each scroll stage of the portal,
   plus a test of opening index.html directly from file:// (no dev server). */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(__dirname, '..');

function staticServer(dir) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.webm': 'video/webm', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  return http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    let fp = path.normalize(path.join(dir, url === '/' ? 'index.html' : url));
    if (!fp.startsWith(dir)) { res.writeHead(403); return res.end(); }
    fs.stat(fp, (err, st) => {
      if (!err && st.isDirectory()) fp = path.join(fp, 'index.html');
      fs.readFile(fp, (err2, data) => {
        if (err2) { res.writeHead(404); return res.end('nf'); }
        res.writeHead(200, { 'content-type': types[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
      });
    });
  });
}

async function settle(page) {
  await page.waitForFunction(() => document.getElementById('loader')?.classList.contains('is-done'), { timeout: 30000 });
  await page.waitForFunction(() => !!document.querySelector('[data-slipstream-demo] section[data-gp-ready]'), { timeout: 20000 });
}

async function snapshot(page, label) {
  const info = await page.evaluate(() => {
    const section = document.querySelector('[data-slipstream-demo] section');
    const content = section?.querySelector('[data-gp-content]');
    const cs = content ? getComputedStyle(content) : null;
    const rect = content?.getBoundingClientRect();
    const mid = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    const midChain = [];
    let el = mid;
    while (el && midChain.length < 4) { midChain.push(el.tagName + (el.dataset ? Object.keys(el.dataset).map((k) => '[' + k + '=' + el.dataset[k] + ']').join('') : '')); el = el.parentElement; }
    const pages = ['.portal-pages', '#materials', '#inside', '#specs', '#buy'].map((s) => {
      const e = document.querySelector(s);
      if (!e) return s + ':MISSING';
      const r = e.getBoundingClientRect();
      return s + ':top=' + Math.round(r.top) + ' h=' + Math.round(r.height);
    });
    return {
      scrollY: Math.round(scrollY),
      docH: document.body.scrollHeight,
      vh: innerHeight,
      gpProgress: section?.dataset.gpProgress,
      gpEntered: section?.dataset.gpEntered,
      gpMotion: section?.dataset.gpMotion,
      contentOpacity: cs?.opacity,
      contentPointer: cs?.pointerEvents,
      contentMarginTop: cs?.marginTop,
      contentRect: rect ? { top: Math.round(rect.top), h: Math.round(rect.height) } : null,
      midChain,
      pages,
    };
  });
  console.log('--- ' + label + ' ---');
  console.log(JSON.stringify(info, null, 1));
}

async function run(url, label) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    await settle(page);
    console.log('\n########## ' + label + ' ##########');
    await snapshot(page, 'start (progress 0)');
    // scroll to 60% of the portal travel
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight * 0.25));
    await new Promise((r) => setTimeout(r, 500));
    await snapshot(page, '25% scrolled');
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight * 0.5));
    await new Promise((r) => setTimeout(r, 500));
    await snapshot(page, '50% scrolled');
    // scroll past the portal entirely
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight * 0.6));
    await new Promise((r) => setTimeout(r, 600));
    await snapshot(page, '60% scrolled (should be past portal)');
    // scroll to the end
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await new Promise((r) => setTimeout(r, 600));
    await snapshot(page, 'bottom');
    console.log('errors:', errs.length ? errs.slice(0, 6) : 'none');
  } catch (e) {
    console.log(label + ' FAILED:', e.message);
    console.log('errors so far:', errs.slice(0, 8));
  }
  await browser.close();
}

(async () => {
  const distDir = path.join(ROOT, 'dist');
  const server = staticServer(distDir);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  await run('http://127.0.0.1:' + port + '/', 'HTTP (vite preview equivalent)');
  server.close();
  await run('file:///' + distDir.replace(/\\/g, '/') + '/index.html', 'FILE:// (double-click index.html)');
})();
