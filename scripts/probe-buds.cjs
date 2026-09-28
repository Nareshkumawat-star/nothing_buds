/* Probe the buds scrub chain: scroll positions vs HUD, loadbar, canvas pixels. */
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
    fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'content-type': types[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
}

(async () => {
  const distDir = path.join(ROOT, 'dist');
  const server = staticServer(distDir);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

  await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => document.getElementById('loader')?.classList.contains('is-done'), { timeout: 30000 });
  await page.waitForFunction(() => !!document.querySelector('[data-slipstream-demo] section[data-gp-ready]'), { timeout: 20000 });

  const probe = await page.evaluate(async () => {
    const stage = document.getElementById('stage');
    const out = {};
    out.stageOffsetTop = stage.offsetTop;
    out.stageH = stage.offsetHeight;
    out.stageLengthVar = getComputedStyle(stage).getPropertyValue('--stage-length');
    out.docH = document.body.scrollHeight;
    out.framesQueued = (window.CMF_FRAMES_BASE || 'no-base') ;

    // scroll to 25% of the stage travel and report
    const probeAt = async (frac) => {
      scrollTo(0, stage.offsetTop + stage.offsetHeight * frac);
      await new Promise((r) => setTimeout(r, 1200));
      const canvas = document.getElementById('frame-canvas');
      const c = canvas.getContext('2d');
      const px = c.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
      return {
        y: Math.round(scrollY),
        rel: Math.round((scrollY - stage.offsetTop) / (stage.offsetHeight - innerHeight) * 1000) / 1000,
        hud: document.getElementById('hud-num')?.textContent,
        fill: document.getElementById('hud-fill')?.style.transform,
        loadbar: document.getElementById('loadbar')?.className,
        canvasCenter: [px[0], px[1], px[2]],
      };
    };
    out.at0 = await probeAt(0);
    out.at25 = await probeAt(0.25);
    out.at60 = await probeAt(0.6);
    out.at95 = await probeAt(0.95);
    return out;
  });

  console.log(JSON.stringify(probe, null, 1));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
