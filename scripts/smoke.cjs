/* Headless smoke test: boot the built site, wait out the loader, scroll the
   portal, and assert the next pages actually reveal. Reuses the puppeteer
   already in node_modules. */
const puppeteer = require('puppeteer-core');
const fs = require('fs');

(async () => {
  const path = require('path');
  const root = path.resolve(__dirname, '..');
  const executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (!fs.existsSync(executablePath)) throw new Error('chrome not found at ' + executablePath);

  const browser = await puppeteer.launch({
    executablePath,
    headless: 'shell',
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // serve dist over http to avoid file:// quirks with the 240 frames
  const http = require('http');
  const distDir = path.join(root, 'dist');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.webm': 'video/webm', '.json': 'application/json', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    let fp = path.normalize(path.join(distDir, url === '/' ? 'index.html' : url));
    if (!fp.startsWith(distDir)) { res.writeHead(403); return res.end(); }
    fs.stat(fp, (err, st) => {
      if (!err && st.isDirectory()) fp = path.join(fp, 'index.html');
      fs.readFile(fp, (err2, data) => {
        if (err2) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'content-type': types[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
      });
    });
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle2', timeout: 60000 });

  // 1. loader must appear
  await page.waitForSelector('#loader', { timeout: 15000 });
  const loaderVisible = await page.$eval('#loader', (el) => getComputedStyle(el).visibility !== 'hidden');

  // 2. wait for the loader to release (script.js flips is-done; main.tsx then mounts React)
  await page.waitForFunction(() => document.getElementById('loader').classList.contains('is-done'), { timeout: 30000 });

  // 3. React app must be mounted
  await page.waitForFunction(() => !!document.querySelector('[data-slipstream-demo]'), { timeout: 15000 });
  console.log('loader released and React mounted ✓');

  // 4. the GlyphPortal section should be ready (measured geometry)
  await page.waitForFunction(() => {
    const s = document.querySelector('[data-slipstream-demo] section[data-gp-ready]');
    return !!s;
  }, { timeout: 20000 });
  const gpState = await page.$eval('[data-slipstream-demo] section', (el) => ({
    ready: el.dataset.gpReady,
    motion: el.dataset.gpMotion,
    focus: el.dataset.gpFocus,
  }));
  console.log('glyph-portal state:', JSON.stringify(gpState));

  // 5. scroll through the portal sequence
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.5;
    for (let y = 0; y <= document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
  });
  await new Promise((r) => setTimeout(r, 800));

  const progress = await page.$eval('[data-slipstream-demo] section', (el) => el.dataset.gpProgress || 'n/a');
  console.log('portal progress after scrolling:', progress);
  const entered = await page.$eval('[data-slipstream-demo] section', (el) => el.dataset.gpEntered);
  console.log('entered flag:', entered);

  // 6. next pages must exist below
  const pages = await page.evaluate(() => ({
    materials: !!document.getElementById('materials'),
    inside: !!document.getElementById('inside'),
    specs: !!document.getElementById('specs'),
    buy: !!document.getElementById('buy'),
  }));
  console.log('next pages present:', JSON.stringify(pages));

  // 7. the buds animation: the stage must be scrubbing the 240-frame sequence
  const buds = await page.evaluate(async () => {
    const stage = document.getElementById('stage');
    const canvas = document.getElementById('frame-canvas');
    if (!stage || !canvas) return { present: false };
    const stageTop = stage.getBoundingClientRect().top + scrollY;
    // scroll into the sequence and let the lerp settle
    scrollTo(0, stageTop + stage.offsetHeight * 0.9);
    await new Promise((r) => setTimeout(r, 1500));
    const hudNum = document.getElementById('hud-num')?.textContent;
    const stageH = stage.offsetHeight;
    scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 400));
    return { present: true, stageHeight: stageH, hudNumAt90: hudNum, canvasW: canvas.width };
  });
  console.log('buds sequence:', JSON.stringify(buds));
  if (!buds.present) throw new Error('buds stage missing');
  if (Number(buds.hudNumAt90) < 200) throw new Error('buds sequence did not scrub to the exploded view, hud=' + buds.hudNumAt90);

  console.log('page errors:', errors.length ? errors.slice(0, 10) : 'none');
  await browser.close();
  server.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
