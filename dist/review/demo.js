// Illustrative interface fixtures only. These are not study documents or observations.
import { blankPayload, validatePayload, ReviewError } from './core.js?v=20261112-clean-links-v4';
import { demoCases } from './fixtures.js?v=20261112-clean-links-v4';
export { demoCases };
export const demoSeed = { gold: demoCases[0].gold, variants: demoCases[0].variants };
export class DemoAPI {
  constructor(mode, storage = globalThis.localStorage) { this.mode = mode; this.storage = storage; this.key = `graphformlib-demo-${mode}-fixtures-v3`; }
  session() { return { user: { id: `demo-${this.mode}-fixtures-v3` } }; }
  load() { try { return JSON.parse(this.storage.getItem(this.key)) ?? {}; } catch { return {}; } }
  put(value) { this.storage.setItem(this.key, JSON.stringify(value)); }
  check() { if (globalThis.navigator?.onLine === false) throw new ReviewError('You are offline. Your draft is kept on this browser.', 'network'); }
  async signOut() {}
  async list() {
    const stored = this.load();
    return { assignments: [1, 2, 3].map(n => ({ id: `demo-${this.mode}-${n}`, mode: this.mode, ordinal: n, genre: demoCases[n - 1].genre, status: stored[n]?.status ?? 'draft', is_test: true })) };
  }
  async get(id) {
    this.check(); const n = Number(id.split('-').at(-1)); if (![1, 2, 3].includes(n)) throw new Error('Unknown demo case');
    const saved = this.load()[n] ?? {}; const fixture = demoCases[n - 1];
    return { id, ordinal: n, total: demoCases.length, mode: this.mode, genre: fixture.genre, is_test: true,
      documents: this.mode === 'absolute' ? [{ label: 'Document', available: true, text: fixture.variants.full_pipeline.text }] : fixture.variant_order.map((kind, i) => ({ label: String.fromCharCode(65 + i), ...fixture.variants[kind] })),
      review_protocol: this.mode === 'absolute' ? 'document-quality-v1' : 'overall-naturalness-v2',
      revision: saved.revision ?? 0, status: saved.status ?? 'draft', payload: saved.payload ?? blankPayload(this.mode),
      revealed: saved.revealed ?? false, gold: saved.revealed ? fixture.gold : null, saved_at: saved.saved_at ?? null,
    };
  }
  async save(id, payload, revision, requestId, submit = false) {
    this.check(); const old = await this.get(id); const n = old.ordinal; const stored = this.load(); const previous = stored[n];
    if (previous?.requestId === requestId) return old;
    if (old.status === 'submitted') throw new ReviewError('This review has already been submitted.');
    if (old.revision !== revision) throw new ReviewError('A newer response is saved. Reload this case before editing.', '40001');
    const errors = validatePayload(old, payload, submit); if (errors.length) throw new ReviewError(errors.join(' '));
    if (old.revealed && ['naturalness', 'realism'].some(k => old.payload.ratings[k] !== payload.ratings[k])) throw new ReviewError('Initial ratings are locked after revealing answers.');
    stored[n] = { ...previous, payload: structuredClone(payload), revision: revision + 1, requestId, status: submit ? 'submitted' : 'draft', saved_at: new Date().toISOString() };
    this.put(stored); return this.get(id);
  }
  async reveal(id, revision) {
    this.check(); const old = await this.get(id); if (old.revealed) return old;
    if (old.revision !== revision || !old.payload.ratings?.naturalness || !old.payload.ratings?.realism) throw new ReviewError('Save both initial ratings first.');
    const stored = this.load(); stored[old.ordinal] = { ...stored[old.ordinal], revealed: true, revision: revision + 1 }; this.put(stored); return this.get(id);
  }
}
