// Reproduce an existing browser with old, cacheable HTML/modules, then upgrade it.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const qa = process.env.GFL_QA_ROOT;
const { chromium } = await import(qa ? `${qa}/node_modules/playwright-core/index.mjs` : 'playwright-core');
let legacy = true;
const requests = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  requests.push(url.pathname + url.search);
  const name = url.pathname.split('/').at(-1) || 'index.html';
  const module = name.endsWith('.js');
  res.setHeader('Cache-Control', module ? 'public,max-age=600' : 'no-store');
  res.setHeader('Content-Type', module ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
  if (legacy && name === 'index.html') {
    res.end('<div id="app"></div><script type="module" src="./app.js"></script>'); return;
  }
  if (legacy && module) {
    res.end(name === 'app.js' ? `import './core.js';import './demo.js';import './config.js';import './taxonomy.js';document.querySelector('#app').textContent='Compare each pair.';` : 'export const stale=true;'); return;
  }
  try { res.end(await readFile(new URL(`../dist/review/${name}`, import.meta.url))); }
  catch { res.statusCode = 404; res.end('Not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/review/?demo=comparative`;
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.getByText('Compare each pair.', { exact: true }).waitFor();
  legacy = false;
  await page.goto(url + '&v=20261112-clean-links-v4');
  await page.getByRole('button', { name: /Start reviewing/ }).click();
  await page.locator('[data-best="A"]').waitFor();
  assert.equal(await page.locator('[data-best]').count(), 4);
  assert.equal(new URL(page.url()).search, '?demo=comparative');
  assert.equal(await page.locator('[data-preference]').count(), 0);
  for (const name of ['app.js','core.js','demo.js','config.js','taxonomy.js']) {
    assert.equal(requests.filter(x => x === `/review/${name}`).length, 1, `Old ${name} must remain cached`);
    assert.ok(requests.includes(`/review/${name}?v=20261112-clean-links-v4`), `${name} needs a versioned URL`);
  }
  await page.locator('[data-best="A"]').check();
  await page.getByRole('button', { name: /Submit this case/ }).click();
  await page.locator('.case-state.submitted').waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, old_cache_reproduced: true, updated_modules_loaded: true, optional_comment_submission: true, live_auth_calls: 0 }));
} finally { await browser.close(); await new Promise(r => server.close(r)); }
