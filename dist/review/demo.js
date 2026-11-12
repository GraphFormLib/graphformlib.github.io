// Illustrative interface fixtures only. These are not study documents or observations.
import { blankPayload, validatePayload, ReviewError } from './core.js';
const gold = { node_meaning: 'web page', edge_meaning: 'one page contains a direct hyperlink to another page', objectives: [
  { objective_family: 'centrality', direction: 'promote', decision_type: 'graph_object_selection' },
  { objective_family: 'path_distance', direction: 'reduce', decision_type: 'graph_object_selection' },
] };
const full = `Subject: Navigation example for Thursday's review

Hi Sam,

Could you choose one of the existing documentation-site examples for Thursday's navigation review? The shared folder has the page lists and direct hyperlinks for each example.

We'd like the overview page to do more work as an intermediary: more of the shortest click routes between other pages should pass through it. We'd also like a short route from the installation page to the troubleshooting page, using as few successive clicks as possible. Please consider both preferences when recommending an example.

Send the example name and a brief explanation before the meeting. We'll use your recommendation to guide the discussion.

Thanks,
Alex`;
const writer = `Subject: Example for the navigation review

Hi Sam,

Please select one existing documentation-site example from our shortlist. The shared records identify its pages and the direct hyperlinks between them.

For the review, we want an example whose overview page is an intermediary on more of the shortest click routes between other pages. We also want the shortest route from the installation page to troubleshooting to require fewer successive clicks. Both criteria should influence your selection.

Please send the example name with a short explanation of how it meets those two preferences.

Thanks,
Alex`;
const minimal = `Navigation review request

Select one existing documentation-site example. Nodes represent pages and directed edges represent direct hyperlinks. The objectives are to promote the centrality of the overview page and reduce path distance from installation to troubleshooting. Centrality is assessed by the overview page's intermediary role on shortest paths between other pages. Distance counts successive hyperlinks.

Use both objectives to choose the example and report the choice with a brief rationale.`;
export const demoSeed = { gold, variants: {
  full_pipeline: { text: full, available: true }, writer_only: { text: writer, available: true },
  minimal_one_shot: { text: minimal, available: true },
} };
export class DemoAPI {
  constructor(mode, storage = globalThis.localStorage) { this.mode = mode; this.storage = storage; this.key = `graphformlib-demo-${mode}-v1`; }
  session() { return { user: { id: `demo-${this.mode}` } }; }
  load() { try { return JSON.parse(this.storage.getItem(this.key)) ?? {}; } catch { return {}; } }
  put(value) { this.storage.setItem(this.key, JSON.stringify(value)); }
  check() { if (globalThis.navigator?.onLine === false) throw new ReviewError('You are offline. Your draft is kept on this browser.', 'network'); }
  async signOut() {}
  async list() {
    const stored = this.load();
    return { assignments: [1, 2, 3].map(n => ({ id: `demo-${this.mode}-${n}`, mode: this.mode, ordinal: n, genre: 'operational_email', status: stored[n]?.status ?? 'draft', is_test: true })) };
  }
  async get(id) {
    this.check(); const n = Number(id.split('-').at(-1)); if (![1, 2, 3].includes(n)) throw new Error('Unknown demo case');
    const saved = this.load()[n] ?? {};
    return { id, ordinal: n, total: 3, mode: this.mode, genre: 'operational_email', is_test: true,
      documents: this.mode === 'absolute' ? [{ label: 'Document', available: true, text: full }] : [
        { label: 'A', text: writer, available: true }, { label: 'B', text: minimal, available: true }, { label: 'C', text: full, available: true },
      ], comparisons: this.mode === 'absolute' ? [] : [{ id: 'p1', left: 'A', right: 'B' }, { id: 'p2', left: 'C', right: 'A' }],
      revision: saved.revision ?? 0, status: saved.status ?? 'draft', payload: saved.payload ?? blankPayload(this.mode),
      revealed: saved.revealed ?? false, gold: saved.revealed ? gold : null, saved_at: saved.saved_at ?? null,
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
