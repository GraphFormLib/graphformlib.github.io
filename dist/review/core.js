export const qualityNames = {
  naturalness: 'Naturalness', realism: 'Realism', semantic_fidelity: 'Semantic fidelity',
};
export const familyNames = {
  centrality: 'Centrality', path_distance: 'Path distance', reachability: 'Reachability',
  robustness: 'Robustness', density: 'Density', community_separation: 'Community separation',
};
export const genreNames = {
  operational_email: 'Operational email', team_conversation: 'Team conversation', meeting_notes: 'Meeting notes',
};
export const choices = ['acceptable', 'needs_revision', 'cannot_judge'];
export function blankPayload(mode) {
  return mode === 'absolute' ? { ratings: {}, notes: {} } : { preferences: {}, notes: {} };
}
export function stableJSON(x) {
  if (Array.isArray(x)) return `[${x.map(stableJSON).join(',')}]`;
  if (x && typeof x === 'object') return `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${stableJSON(x[k])}`).join(',')}}`;
  return JSON.stringify(x);
}
export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function renderDocument(value) {
  const parts = []; let list = false; let paragraph = [];
  const inline = s => escapeHTML(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const flush = () => { if (paragraph.length) { parts.push(`<p>${inline(paragraph.join(' '))}</p>`); paragraph = []; } };
  const close = () => { if (list) { parts.push('</ul>'); list = false; } };
  for (const line of String(value ?? '').split('\n')) {
    if (!line.trim()) { flush(); close(); continue; }
    if (/^#{1,3} /.test(line) || /^\*\*[^*]+\*\*$/.test(line)) {
      flush(); close(); parts.push(`<h3>${inline(line.replace(/^#{1,3} /, '').replace(/^\*\*(.*)\*\*$/, '$1'))}</h3>`);
    } else if (line.startsWith('- ')) {
      flush(); if (!list) { parts.push('<ul>'); list = true; } parts.push(`<li>${inline(line.slice(2))}</li>`);
    } else { close(); paragraph.push(line); }
  }
  flush(); close(); return parts.join('');
}
export function validatePayload(item, payload, submit = true) {
  const errors = [];
  if (item.mode === 'absolute') {
    for (const [key, title] of Object.entries(qualityNames)) {
      const value = payload.ratings?.[key];
      if (value && !choices.includes(value)) errors.push(`${title}: select a valid response.`);
      if (submit && !value) errors.push(`${title}: select a response.`);
      if (submit && value === 'needs_revision' && !payload.notes?.[key]?.trim()) errors.push(`${title}: briefly describe the revision.`);
    }
    if (submit && !item.revealed) errors.push('Review the answer sheet before submitting.');
  } else {
    for (const pair of item.comparisons) {
      const value = payload.preferences?.[pair.id];
      const unavailable = [pair.left, pair.right].some(label => !item.documents.find(d => d.label === label)?.available);
      if (submit && !value) errors.push(`Comparison ${pair.id.slice(1)}: select a response.`);
      if (value && !['left', 'right', 'tie', 'cannot_judge'].includes(value)) errors.push('Select a valid comparison.');
      if (unavailable && value && value !== 'cannot_judge') errors.push('Choose Cannot judge when a version is unavailable.');
      if (submit && ['left', 'right'].includes(value) && !payload.notes?.[pair.id]?.trim()) errors.push(`Comparison ${pair.id.slice(1)}: briefly explain your preference.`);
    }
  }
  if (Object.values(payload.notes ?? {}).some(t => t.length > 2000)) errors.push('Keep each note within 2,000 characters.');
  return errors;
}

export class ReviewError extends Error {
  constructor(message, code = '') { super(message); this.code = code; }
}

export class SupabaseReviewAPI {
  constructor(config, storage = globalThis.localStorage, fetcher = globalThis.fetch) {
    this.config = config; this.storage = storage; this.fetcher = fetcher.bind(globalThis); this.refreshPromise = null;
  }
  session() { try { return JSON.parse(this.storage.getItem(this.config.sessionKey)); } catch { return null; } }
  setSession(value) {
    if (value) this.storage.setItem(this.config.sessionKey, JSON.stringify({ ...value, expires_at: value.expires_at ?? Math.floor(Date.now() / 1000) + value.expires_in }));
    else this.storage.removeItem(this.config.sessionKey);
  }
  async request(path, body, token = null) {
    let response;
    try {
      response = await this.fetcher(`${this.config.supabaseUrl}${path}`, {
        method: 'POST', headers: { apikey: this.config.publishableKey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
      });
    } catch { throw new ReviewError('Could not reach the server. Your draft is kept on this browser. Please retry when connected.', 'network'); }
    const raw = await response.text(); let data;
    try { data = raw ? JSON.parse(raw) : null; } catch { throw new ReviewError('The server returned an unexpected response. Your draft is kept locally.', 'network'); }
    if (!response.ok) {
      if (data?.code === 'PGRST202') throw new ReviewError('The review database has not been set up yet. Please contact the study coordinator.', 'setup');
      throw new ReviewError(data?.message ?? data?.msg ?? 'The request could not be saved.', data?.code ?? String(response.status));
    }
    return data;
  }
  async signIn(email, password) {
    let data;
    try { data = await this.request('/auth/v1/token?grant_type=password', { email, password }); }
    catch (e) { if (e.code !== 'network') throw new ReviewError('Sign-in failed. Check the account details supplied to you.', 'signin'); throw e; }
    this.setSession(data); return data;
  }
  async token() {
    const session = this.session();
    if (!session?.access_token) throw new ReviewError('Please sign in to continue.', 'signin');
    if (session.expires_at > Date.now() / 1000 + 60) return session.access_token;
    if (!this.refreshPromise) {
      const refresh = async () => {
        const latest = this.session();
        if (latest?.expires_at > Date.now() / 1000 + 60) return latest.access_token;
        if (!latest?.refresh_token) throw new ReviewError('Please sign in again. Your draft is kept locally.', 'signin');
        const data = await this.request('/auth/v1/token?grant_type=refresh_token', { refresh_token: latest.refresh_token });
        this.setSession(data); return data.access_token;
      };
      this.refreshPromise = (globalThis.navigator?.locks ? navigator.locks.request('graphformlib-review-refresh', refresh) : refresh()).finally(() => { this.refreshPromise = null; });
    }
    return this.refreshPromise;
  }
  async signOut() {
    const session = this.session();
    try { if (session?.access_token) await this.request('/auth/v1/logout', {}, session.access_token); } finally { this.setSession(null); }
  }
  async rpc(name, body = {}) { return this.request(`/rest/v1/rpc/${name}`, body, await this.token()); }
  async list() { return this.rpc('review_list_assignments'); }
  async get(id) { return this.rpc('review_get_case', { p_assignment_id: id }); }
  async save(id, payload, revision, requestId, submit = false) {
    return this.rpc(submit ? 'review_submit_case' : 'review_save_draft', { p_assignment_id: id, p_payload: payload, p_revision: revision, p_request_id: requestId });
  }
  async reveal(id, revision) { return this.rpc('review_reveal_key', { p_assignment_id: id, p_revision: revision }); }
}
