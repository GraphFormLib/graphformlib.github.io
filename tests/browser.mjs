import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { demoSeed } from '../dist/review/demo.js';
import { taxonomy } from '../dist/review/taxonomy.js';
const qa = process.env.GFL_QA_ROOT;
const { chromium } = await import(qa ? `${qa}/node_modules/playwright-core/index.mjs` : 'playwright-core');
const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const screenshots = process.env.GFL_SCREENSHOT_DIR || fileURLToPath(new URL('../screenshots', import.meta.url));
await mkdir(screenshots, { recursive: true });
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'); let path = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!path.startsWith(root + '/') && path !== root) throw new Error('Forbidden');
    if (url.pathname.endsWith('/')) path += '/index.html';
    const body = await readFile(path); res.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.GFL_CHROMIUM || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
let checks = 0; const failures = []; const ok = name => { checks++; console.log('PASS', name); };
try {
  const context = await browser.newContext({ viewport: { width: 1512, height: 1050 }, deviceScaleFactor: 1 });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/review/'); await page.getByRole('heading', { name: 'Welcome back.' }).waitFor();
  await page.screenshot({ path: resolve(screenshots, 'signin.png'), fullPage: true }); ok('sign-in and both demo links render');
  await page.goto(base + '/review/?demo=absolute'); await page.getByRole('heading', { name: 'Understanding graph objectives' }).waitFor();
  assert.equal(await page.locator('#main .taxonomy-card').count(), 6); assert.equal(await page.locator('.document-body').count(), 0);
  assert.ok(await page.locator('[data-case]').first().isDisabled());
  for (const f of taxonomy.families) assert.ok(await page.locator('#main .taxonomy-reference').getByText(f.definition, { exact: true }).isVisible());
  await page.screenshot({ path: resolve(screenshots, 'taxonomy-introduction.png'), fullPage: true }); ok('canonical taxonomy introduction precedes all documents and cases');
  await page.getByRole('button', { name: /Start reviewing/ }).click(); await page.getByRole('heading', { name: 'Review the document' }).waitFor();
  assert.equal(await page.locator('.answer-sheet').count(), 0);
  await page.getByRole('button', { name: /Reveal answer sheet/ }).click(); await page.getByText('Choose a naturalness and realism response').waitFor({ state: 'visible' }); ok('answer sheet cannot be revealed before initial ratings');
  await page.locator('input[name=naturalness][value=acceptable]').check();
  await page.locator('input[name=realism][value=acceptable]').check();
  await page.waitForFunction(() => document.querySelector('#save-indicator').textContent.includes('Saved in this browser'));
  await page.getByRole('button', { name: 'Objective taxonomy' }).click(); await page.locator('#taxonomy-dialog').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /Back to review/ }).click();
  assert.ok(await page.locator('input[name=naturalness][value=acceptable]').isChecked()); ok('taxonomy reference reopens without losing draft ratings');
  await page.screenshot({ path: resolve(screenshots, 'absolute-first-reading.png'), fullPage: true });
  await page.reload(); await page.locator('input[name=naturalness][value=acceptable]').waitFor();
  assert.ok(await page.locator('input[name=naturalness][value=acceptable]').isChecked()); ok('initial ratings autosave and resume after reload');
  await page.getByRole('button', { name: /Reveal answer sheet/ }).click(); await page.locator('.answer-sheet').waitFor();
  assert.ok(await page.locator('input[name=realism][value=acceptable]').isDisabled()); ok('answer reveal locks initial ratings and shows intended annotations');
  assert.equal(await page.locator('.answer-sheet .objective-definition').count(), 2);
  const centrality = taxonomy.families.find(f => f.objective_family_id === 'centrality');
  assert.ok(await page.locator('.answer-sheet').getByText(centrality.definition, { exact: true }).isVisible());
  assert.ok(await page.locator('.answer-sheet').getByText(taxonomy.directions.promote, { exact: true }).isVisible());
  assert.ok(await page.locator('.answer-sheet').getByText(taxonomy.decision_types.graph_object_selection, { exact: true }).isVisible());
  assert.ok(await page.getByText('Does the document reasonably support the listed node/edge meanings and objectives?', { exact: true }).isVisible());
  assert.equal(await page.getByText(/materially competing interpretation/).count(), 0); ok('annotations show canonical definitions and the relaxed support question');
  await page.screenshot({ path: resolve(screenshots, 'absolute-answer-sheet.png'), fullPage: true });
  await page.locator('input[name=semantic_fidelity][value=needs_revision]').check();
  await page.getByRole('button', { name: /Submit this case/ }).click(); await page.getByText('Semantic fidelity: briefly describe the revision.').waitFor(); ok('revision request cannot submit without explanation');
  await page.locator('#note-semantic_fidelity').fill('Interface test only: checking the comment field.');
  await page.getByRole('button', { name: /Submit this case/ }).click(); await page.locator('.case-state.submitted').waitFor();
  await page.reload(); await page.locator('.case-state.submitted').waitFor(); assert.ok(await page.locator('input[name=semantic_fidelity][value=needs_revision]').isDisabled()); ok('submitted responses persist and are read-only');
  await page.getByRole('button', { name: 'Next case →' }).click();
  await context.setOffline(true);
  await page.locator('input[name=naturalness][value=acceptable]').check();
  await page.waitForFunction(() => document.querySelector('#save-indicator').textContent.includes('upload pending')); ok('offline change is marked locally pending rather than server-saved');
  await context.setOffline(false);
  await page.waitForFunction(() => document.querySelector('#save-indicator').textContent.includes('Saved in this browser')); ok('pending save resumes on reconnect');
  // A deliberate lost acknowledgment: the pending request ID is reused after reload.
  await page.evaluate(() => {
    const key = 'graphformlib-outbox-v1:demo-absolute-fixtures-v3:demo-absolute-2';
    const saved = JSON.parse(localStorage.getItem('graphformlib-demo-absolute-fixtures-v3'))[2];
    localStorage.setItem(key, JSON.stringify({ revision: saved.revision - 1, payload: { ...saved.payload, notes: { naturalness: 'Local note after a lost acknowledgment.' } }, pending: { id: 'demo-absolute-2', payload: saved.payload, revision: saved.revision - 1, requestId: saved.requestId, submit: false } }));
  });
  await page.reload(); await page.waitForFunction(() => document.querySelector('#save-indicator')?.textContent.includes('Saved in this browser'));
  const recovered = await page.evaluate(() => JSON.parse(localStorage.getItem('graphformlib-demo-absolute-fixtures-v3'))[2]);
  assert.equal(recovered.payload.notes.naturalness, 'Local note after a lost acknowledgment.'); ok('lost-save acknowledgment recovers without losing newer local notes');
  await page.goto(base + '/review/?demo=comparative'); await page.locator('.version-card').first().waitFor();
  assert.equal(await page.locator('#begin-review').count(), 0); ok('taxonomy introduction is remembered across the two demo workflows');
  assert.equal(await page.locator('.version-card').count(), 3); assert.equal(await page.locator('.answer-sheet').count(), 0);
  await page.screenshot({ path: resolve(screenshots, 'comparison-desktop.png'), fullPage: true }); ok('comparison shows three anonymous versions and no answer sheet');
  assert.equal(await page.locator('[data-best]').count(), 4); assert.equal(await page.locator('[data-preference]').count(), 0);
  await page.getByRole('button', { name: /Submit this case/ }).click();
  await page.getByText('Choose the most natural version, tied versions, or Cannot judge.').waitFor();
  await page.locator('[data-best="A"]').check(); await page.locator('[data-best="C"]').check();
  await page.waitForFunction(() => document.querySelector('#save-indicator').textContent.includes('Saved in this browser'));
  await page.reload(); await page.locator('[data-best="A"]').waitFor();
  assert.ok(await page.locator('[data-best="A"]').isChecked()); assert.ok(await page.locator('[data-best="C"]').isChecked());
  await page.locator('[data-best="cannot_judge"]').check();
  assert.equal(await page.locator('[data-best="A"]').isChecked(), false); assert.equal(await page.locator('[data-best="C"]').isChecked(), false);
  await page.locator('[data-best="A"]').check(); assert.equal(await page.locator('[data-best="cannot_judge"]').isChecked(), false);
  await page.locator('[data-best="C"]').check();
  await page.getByRole('button', { name: /Submit this case/ }).click(); await page.locator('.case-state.submitted').waitFor();
  await page.reload(); await page.locator('.case-state.submitted').waitFor();
  assert.ok(await page.locator('[data-best="A"]').isDisabled());
  ok('single overall preference supports ties, autosave, reload and submission without a comment');
  const firstComparison = await page.locator('.version-grid').innerText();
  await page.getByRole('button', { name: 'Next case →' }).click(); await page.locator('.version-card').first().waitFor();
  const secondComparison = await page.locator('.version-grid').innerText();
  assert.notEqual(firstComparison,secondComparison); assert.ok(secondComparison.includes('Maya:'));
  await page.getByRole('button', { name: 'Next case →' }).click(); await page.locator('.version-card').first().waitFor();
  const thirdComparison = await page.locator('.version-grid').innerText();
  assert.notEqual(secondComparison,thirdComparison); assert.notEqual(firstComparison,thirdComparison);
  assert.ok(thirdComparison.includes('Riverside')); ok('all three case buttons lead to different scenarios and genres');
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const phone = await mobile.newPage(); phone.on('pageerror', e => errors.push(e.message));
  await phone.goto(base + '/review/?demo=comparative'); await phone.getByRole('button', { name: /Start reviewing/ }).waitFor();
  assert.equal(await phone.locator('.document-body').count(), 0);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await phone.screenshot({ path: resolve(screenshots, 'taxonomy-introduction-mobile.png'), fullPage: true });
  await phone.getByRole('button', { name: /Start reviewing/ }).click(); await phone.locator('.version-card.mobile-active').waitFor();
  ok('comparison workflow has the same mobile-friendly orientation');
  await phone.getByRole('tab', { name: 'Version B' }).click(); assert.ok(await phone.locator('#version-B').isVisible());
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await phone.screenshot({ path: resolve(screenshots, 'comparison-mobile.png'), fullPage: true }); ok('mobile version tabs work without horizontal overflow');
  await phone.goto(base + '/review/?demo=absolute'); await phone.locator('.document-body').waitFor();
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false); ok('mobile document review fits the screen');
  await mobile.close();
  await page.goto(base + '/review/');
  page.on('requestfailed', request => console.log('REQUEST_FAILURE', new URL(request.url()).pathname, request.failure()?.errorText));
  page.on('console', message => { if (message.type() === 'error') console.log('CONSOLE_ERROR', message.text()); });
  await page.route('https://tcibyolqmgpzvspiyfbk.supabase.co/**', async route => {
    const headers = { 'access-control-allow-origin': base, 'access-control-allow-headers': 'apikey,authorization,content-type', 'access-control-allow-methods': 'POST,OPTIONS' };
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    const auth = route.request().url().includes('/auth/v1/token');
    await route.fulfill({ status: auth ? 200 : 404, headers, contentType: 'application/json', body: JSON.stringify(auth ? { access_token: 'test-token', refresh_token: 'test-refresh', expires_in: 3600, user: { id: 'backend-setup-test' } } : { code: 'PGRST202' }) });
  });
  await page.locator('input[name=email]').fill('test@example.invalid'); await page.locator('input[name=password]').fill('dummy-local-test-only');
  await page.getByRole('button', { name: /Open my workspace/ }).click();
  try { await page.getByText(/review database has not been set up yet/).waitFor({ timeout: 10000 }); }
  catch (error) {
    console.log('LOGIN_DIAGNOSTIC', await page.locator('#signin-error').textContent().catch(() => 'no login error element'));
    console.log('PAGE_ERRORS', errors);
    await page.screenshot({ path: resolve(screenshots, 'backend-message-diagnostic.png'), fullPage: true });
    throw error;
  }
  ok('uninitialized backend produces a clear setup message');
  // Exercise the actual REST adapter against a controlled backend, without remote accounts.
  await page.unroute('https://tcibyolqmgpzvspiyfbk.supabase.co/**');
  const remote = { id: '90000000-0000-0000-0000-000000000001', mode: 'absolute', ordinal: 1, total: 1, genre: 'operational_email', is_test: true,
    documents: [{ label: 'Document', text: demoSeed.variants.full_pipeline.text, available: true }], comparisons: [], revision: 0, status: 'draft', payload: {}, revealed: false, gold: null };
  await page.route('https://tcibyolqmgpzvspiyfbk.supabase.co/**', async route => {
    const headers = { 'access-control-allow-origin': base, 'access-control-allow-headers': 'apikey,authorization,content-type', 'access-control-allow-methods': 'POST,OPTIONS' };
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    const path = new URL(route.request().url()).pathname; const body = route.request().postDataJSON(); let result;
    if (path.includes('/auth/v1/token')) result = { access_token: 'test-token', refresh_token: 'test-refresh', expires_in: 3600, user: { id: 'backend-setup-test' } };
    else if (path.endsWith('review_list_assignments')) result = { assignments: [{ id: remote.id, mode: 'absolute', ordinal: 1, genre: remote.genre, status: remote.status, is_test: true }] };
    else if (path.endsWith('review_get_case')) result = remote;
    else if (path.endsWith('review_reveal_key')) { remote.revealed = true; remote.gold = demoSeed.gold; remote.revision++; result = remote; }
    else {
      assert.equal(route.request().headers().authorization, 'Bearer test-token');
      if (remote.last_request_id !== body.p_request_id) { remote.payload = body.p_payload; remote.revision++; remote.last_request_id = body.p_request_id; remote.saved_at = new Date().toISOString(); }
      if (path.endsWith('review_submit_case')) remote.status = 'submitted'; result = remote;
    }
    await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(result) });
  });
  await page.locator('input[name=password]').fill('dummy-local-test-only');
  await page.getByRole('button', { name: /Open my workspace/ }).click();
  await page.getByRole('button', { name: /Start reviewing/ }).click(); await page.locator('.document-body').waitFor();
  await page.locator('input[name=naturalness][value=acceptable]').check(); await page.locator('input[name=realism][value=acceptable]').check();
  await page.waitForFunction(() => document.querySelector('#save-indicator').textContent.trim()==='Saved');
  await page.reload(); assert.ok(await page.locator('input[name=realism][value=acceptable]').isChecked());
  await page.getByRole('button', { name: /Reveal answer sheet/ }).click(); await page.locator('.answer-sheet').waitFor();
  await page.locator('input[name=semantic_fidelity][value=acceptable]').check(); await page.getByRole('button', { name: /Submit this case/ }).click(); await page.locator('.case-state.submitted').waitFor();
  assert.equal(remote.status,'submitted'); ok('real REST adapter signs in, autosaves, resumes, reveals and submits against a controlled backend');
  assert.deepEqual(errors, []); ok('no uncaught browser exceptions');
  console.log(JSON.stringify({ passed: true, checks, screenshots, live_auth_calls: 0, human_observations: 0 }));
  await context.close();
} finally {
  await browser.close(); await new Promise(r => server.close(r));
}
