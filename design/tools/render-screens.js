// Secure360 — re-render every Stitch screen from its code.html.
// Why: Stitch exports sometimes keep an old screen.png after an edit; the
// code.html is always current. This script produces fresh, consistent PNGs.
//
// Usage (needs an internet connection: Tailwind and fonts load from CDNs):
//   npm install puppeteer
//   npm run render   (from design/tools; see design/README.md)
//
// Mobile screens (under design/stitch/mobile, or an original Stitch export folder) are
// rendered at 390 px wide, web screens at 1440 px wide, full page, 2x scale.

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const root = process.argv[2];
const out = process.argv[3] || path.join(process.cwd(), 'renders');
if (!root) {
  console.error('Usage: node render_screens.js <unzipped-exports-folder> [output-folder]');
  process.exit(1);
}

function findHtml(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findHtml(p));
    else if (entry.name === 'code.html') found.push(p);
  }
  return found;
}

(async () => {
  const files = findHtml(path.resolve(root));
  if (files.length === 0) {
    console.error('No code.html found under', root);
    process.exit(1);
  }
  fs.mkdirSync(path.join(out, 'mobile'), { recursive: true });
  fs.mkdirSync(path.join(out, 'web'), { recursive: true });

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  let ok = 0;
  for (const file of files) {
    const isMobile = file.includes('design_system_specifications') || file.split(path.sep).includes('mobile');
    const name = path.basename(path.dirname(file));
    await page.setViewport(isMobile
      ? { width: 390, height: 844, deviceScaleFactor: 2 }
      : { width: 1440, height: 900, deviceScaleFactor: 2 });
    try {
      await page.goto('file://' + file, { waitUntil: 'networkidle0', timeout: 60000 });
      await page.evaluate(() => document.fonts && document.fonts.ready);
      await new Promise((r) => setTimeout(r, 800)); // let charts and icon fonts settle
      const target = path.join(out, isMobile ? 'mobile' : 'web', name + '.png');
      await page.screenshot({ path: target, fullPage: true });
      console.log('OK  ', isMobile ? 'mobile' : 'web   ', name);
      ok++;
    } catch (e) {
      console.log('FAIL', name, '-', e.message);
    }
  }
  await browser.close();
  console.log(`\n${ok}/${files.length} screens rendered into ${out}`);
})();