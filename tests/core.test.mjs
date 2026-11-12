import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDocument, stableJSON, validatePayload, SupabaseReviewAPI } from '../dist/review/core.js';
import { DemoAPI } from '../dist/review/demo.js';
import { taxonomy } from '../dist/review/taxonomy.js';
const memory = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }; };
const absolute = { mode: 'absolute', revealed: true };
test('reviewer taxonomy contains all six canonical families, directions and decision types with source binding', () => {
  assert.equal(taxonomy.library_version, 'objective-library-v3'); assert.match(taxonomy.source_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(taxonomy.families.map(f => f.objective_family_id).sort(), ['centrality','community_separation','density','path_distance','reachability','robustness']);
  assert.deepEqual(Object.keys(taxonomy.directions).sort(), ['promote','reduce']);
  assert.deepEqual(Object.keys(taxonomy.decision_types).sort(), ['graph_intervention','graph_object_selection']);
  assert.ok(taxonomy.families.every(f => f.definition && f.direction_semantics.promote && f.direction_semantics.reduce));
});
test('document rendering escapes active HTML while retaining ordinary headings and bullets', () => {
  const html = renderDocument('## Review\n\n<img src=x onerror=alert(1)>\n\n- **A**\n- B');
  assert.ok(html.includes('&lt;img')); assert.ok(!html.includes('<img')); assert.ok(html.includes('<h3>Review</h3>')); assert.ok(html.includes('<strong>A</strong>')); assert.equal((html.match(/<ul>/g) ?? []).length, 1);
});
test('JSON comparison ignores database key-order differences', () => assert.equal(stableJSON({ z: 1, a: { x: 2, a: 3 } }), stableJSON({ a: { a: 3, x: 2 }, z: 1 })));
test('positive absolute responses do not require commentary', () => assert.deepEqual(validatePayload(absolute, { ratings: { naturalness: 'acceptable', realism: 'acceptable', semantic_fidelity: 'acceptable' }, notes: {} }), []));
test('revision requests require a short note and semantic review requires a reveal', () => {
  assert.ok(validatePayload({ ...absolute, revealed: false }, { ratings: { naturalness: 'needs_revision', realism: 'acceptable', semantic_fidelity: 'acceptable' } }).length === 2);
});
test('missing versions cannot receive naturalness preferences', () => {
  const item = { mode: 'comparative', documents: [{ label: 'A', available: false }, { label: 'B', available: true }], comparisons: [{ id: 'p1', left: 'A', right: 'B' }] };
  assert.ok(validatePayload(item, { preferences: { p1: 'right' }, notes: { p1: 'Readable.' } }).length);
  assert.deepEqual(validatePayload(item, { preferences: { p1: 'cannot_judge' } }), []);
});
test('demo hides the answer sheet until explicit initial-review reveal and resumes saved answers', async () => {
  const storage = memory(); const api = new DemoAPI('absolute', storage); const id = 'demo-absolute-1';
  assert.equal((await api.get(id)).gold, null);
  await assert.rejects(api.reveal(id, 0));
  await api.save(id, { ratings: { naturalness: 'acceptable', realism: 'acceptable' }, notes: {} }, 0, 'req1');
  assert.equal((await api.save(id, {}, 0, 'req1')).revision, 1);
  const revealed = await api.reveal(id, 1); assert.ok(revealed.gold);
  assert.equal((await new DemoAPI('absolute', storage).get(id)).payload.ratings.realism, 'acceptable');
  await assert.rejects(api.save(id, { ratings: { naturalness: 'needs_revision', realism: 'acceptable' } }, 2, 'req2'));
});
test('API uses only browser key plus reviewer token, and recognizes an uninitialized backend', async () => {
  const storage = memory(); let seen;
  const api = new SupabaseReviewAPI({ supabaseUrl: 'https://example.invalid', publishableKey: 'sb_publishable_test', sessionKey: 'test' }, storage, async (url, opts) => {
    seen = { url, opts }; return new Response(JSON.stringify({ code: 'PGRST202' }), { status: 404 });
  });
  api.setSession({ access_token: 'user-token', refresh_token: 'refresh-token', expires_in: 3600, user: { id: 'one' } });
  await assert.rejects(api.list(), e => e.code === 'setup'); assert.equal(seen.opts.headers.Authorization, 'Bearer user-token'); assert.equal(seen.opts.headers.apikey, 'sb_publishable_test');
});
test('network failures never produce false saved acknowledgments', async () => {
  const api = new SupabaseReviewAPI({ supabaseUrl: 'https://example.invalid', publishableKey: 'x' }, memory(), async () => { throw new Error('offline'); });
  await assert.rejects(api.request('/test', {}), e => e.code === 'network');
});
