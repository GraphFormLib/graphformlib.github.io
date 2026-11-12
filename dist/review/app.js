import { config } from './config.js';
import { SupabaseReviewAPI, blankPayload, escapeHTML as h, renderDocument, stableJSON, validatePayload, qualityNames, familyNames, genreNames } from './core.js';
import { DemoAPI } from './demo.js';
import { taxonomy } from './taxonomy.js';

const demoMode = new URLSearchParams(location.search).get('demo');
const demo = ['absolute', 'comparative'].includes(demoMode);
const api = demo ? new DemoAPI(demoMode) : new SupabaseReviewAPI(config);
const state = { assignments: [], mode: null, item: null, payload: null, dirty: false, timer: null, pending: null, flushing: null, conflict: null, navigating: false, error: '', saveState: 'idle' };
const app = document.querySelector('#app');
const mark = `<span class="brand-mark" aria-hidden="true">G</span>`;
const modeName = mode => mode === 'absolute' ? 'Document review' : 'Version comparison';
const localKey = id => `graphformlib-outbox-${state.mode === 'comparative' ? 'v2' : 'v1'}:${api.session()?.user?.id ?? 'signed-out'}:${id}`;
const guideVersion = `${taxonomy.library_version}-introduction-v1`;
const guideKey = () => `graphformlib-taxonomy-guide:${guideVersion}:${demo ? 'demo' : api.session()?.user?.id}`;
let guideRead = false;
const decisionName = key => key === 'graph_object_selection' ? 'Selection' : 'Intervention';
function hasReadGuide() { try { return guideRead || localStorage.getItem(guideKey()) === 'read'; } catch { return guideRead; } }

function taxonomyContent(titleId) {
  return `<section class="taxonomy-reference"><span class="eyebrow">A SHORT INTRODUCTION</span><h2 id="${titleId}">Understanding graph objectives</h2><p class="taxonomy-lead">An objective has three parts: the structural property, its desired direction, and the kind of decision. These are the definitions from our objective library.</p><h3>Six objective families</h3><div class="taxonomy-grid">${taxonomy.families.map(f => `<article class="taxonomy-card"><h4>${h(f.name)}</h4><p>${h(f.definition)}</p></article>`).join('')}</div><div class="taxonomy-parts"><section><h3>Two directions</h3>${Object.entries(taxonomy.directions).map(([key,value]) => `<dl><dt>${key === 'promote' ? 'Promote' : 'Reduce'}</dt><dd>${h(value)}</dd></dl>`).join('')}</section><section><h3>Two decision types</h3>${Object.entries(taxonomy.decision_types).map(([key,value]) => `<dl><dt>${decisionName(key)}</dt><dd>${h(value)}</dd></dl>`).join('')}</section></div><p class="helper">Naturalness concerns whether the communication fits its audience. Technical language can be appropriate. For annotation review, judge whether the document reasonably supports the listed meanings and objectives.</p><p class="taxonomy-source">Definitions: GraphFormLib ${h(taxonomy.library_version)}. You can reopen this guide at any time.</p></section>`;
}

function showIntroduction(first) {
  document.querySelector('#main').innerHTML = `<div class="taxonomy-onboarding"><div id="case-messages" aria-live="polite"></div>${taxonomyContent('taxonomy-introduction-title')}<div class="taxonomy-start"><p>Read this once before starting. There is no quiz.</p><button class="button primary" id="begin-review">Start reviewing <span aria-hidden="true">→</span></button></div></div>`;
  for (const button of document.querySelectorAll('[data-case]')) button.disabled = true;
  document.querySelector('#begin-review').onclick = async () => {
    guideRead = true; try { localStorage.setItem(guideKey(), 'read'); } catch { /* The current visit can continue. */ }
    try { await openCase(first.id); window.scrollTo({ top: 0, behavior: 'instant' }); } catch (err) { showError(err); }
  };
}

function login(message = '') {
  guideRead = false; clearTimeout(state.timer); state.item = null; state.payload = null; state.pending = null; state.dirty = false; state.conflict = null;
  app.innerHTML = `<div class="welcome"><section class="welcome-story"><a class="brand" href="../">${mark}GraphFormLib</a><div class="welcome-copy"><span class="eyebrow">REVIEW WORKSPACE</span><h1>A careful reading.<br>A better resource.</h1><p>Help us assess how clearly and naturally application documents communicate their intended graph problems.</p><div class="welcome-pills"><span>Independent judgments</span><span>Save & resume</span></div></div><div class="welcome-footer">Thank you for lending us your judgment.</div></section><main id="main" class="signin-panel"><div class="signin-card"><span class="eyebrow">FOR INVITED REVIEWERS</span><h2>Welcome back.</h2><p class="subtle">Sign in with the account supplied by the study coordinator. Your assignments and progress will be ready for you.</p><form id="signin"><label>Email<input name="email" type="email" autocomplete="username" required placeholder="Your reviewer account"></label><label>Password<input name="password" type="password" autocomplete="current-password" required placeholder="Your password"></label><div id="signin-error" class="error-message" role="alert">${h(message)}</div><button class="button primary wide" type="submit">Open my workspace <span aria-hidden="true">→</span></button></form><div class="demo-links"><span class="eyebrow">TRY THE INTERFACE</span><p>No account needed. Demo answers stay in this browser and are excluded from the study.</p><a href="?demo=absolute">Try document review <span aria-hidden="true">↗</span></a><a href="?demo=comparative">Try version comparison <span aria-hidden="true">↗</span></a></div></div></main></div>`;
  document.querySelector('#signin').addEventListener('submit', async e => {
    e.preventDefault(); const button = e.target.querySelector('button'); button.disabled = true; button.textContent = 'Signing in…';
    const values = new FormData(e.target);
    try { await api.signIn(values.get('email'), values.get('password')); await start(); }
    catch (err) { document.querySelector('#signin-error').textContent = err.message; button.disabled = false; button.textContent = 'Open my workspace →'; }
  });
}

function shell() {
  app.innerHTML = `<div class="workspace"><aside class="sidebar"><a class="brand" href="../">${mark}GraphFormLib</a><div class="sidebar-intro"><span class="eyebrow">YOUR WORKSPACE</span><h2 id="sidebar-title"></h2><p>Read carefully. Trust your judgment.<br>You can save and return later.</p></div><div id="mode-switch"></div><div class="progress-section"><div class="progress-copy"><span>Submitted</span><strong id="progress-count"></strong></div><div class="progress-track"><span id="progress-fill"></span></div></div><nav id="case-nav" aria-label="Assigned cases"></nav><div class="sidebar-bottom"><details class="review-guide"><summary>Review guidance</summary><p>Judge material issues, rather than personal preferences. Ordinary motivation may remain implicit. Routine confirmation and repetition can be appropriate.</p><p>Use <em>Cannot judge</em> when you lack enough context or domain familiarity. Briefly explain a requested revision. Comments on version preferences are optional.</p><p>Selection means choosing an existing supported object or case. Intervention means applying a change to topology or relationship availability.</p></details><button id="signout" class="text-button">${demo ? 'Leave demo' : 'Sign out'}</button>${demo ? '<button id="reset-demo" class="text-button">Reset demo answers</button>' : ''}</div></aside><div class="workspace-content">${demo ? '<div class="test-banner"><span class="status-dot"></span>Demo workspace · illustrative documents · saved only in this browser · excluded from study <a href="?demo=' + (demoMode === 'absolute' ? 'comparative' : 'absolute') + '">Try ' + (demoMode === 'absolute' ? 'comparison' : 'document review') + ' ↗</a></div>' : '<div id="test-banner"></div>'}<header class="topbar"><div><span class="eyebrow">INDEPENDENT REVIEW</span><h1 id="workspace-title"></h1></div><div class="save-indicator" id="save-indicator" role="status" aria-live="polite"><span class="status-dot"></span><span>Ready</span></div></header><main id="main" tabindex="-1"></main><footer class="workspace-footer">GraphFormLib · Review workspace<span>Your responses are not visible to other reviewers.</span></footer></div></div>`;
  document.querySelector('#signout').onclick = async () => {
    try { await flush(); } catch { /* Retain the local outbox if offline. */ }
    if (demo) { location.href = './'; return; }
    await api.signOut().catch(() => {}); login();
  };
  const guideButton = document.createElement('button'); guideButton.className = 'text-button taxonomy-open'; guideButton.textContent = 'Objective taxonomy'; guideButton.type = 'button';
  document.querySelector('.sidebar-bottom').prepend(guideButton);
  const dialog = document.createElement('dialog'); dialog.id = 'taxonomy-dialog'; dialog.setAttribute('aria-labelledby', 'taxonomy-dialog-title');
  dialog.innerHTML = `<div class="taxonomy-dialog-top"><button type="button" class="button secondary" id="close-taxonomy">Back to review ×</button></div>${taxonomyContent('taxonomy-dialog-title')}`;
  app.append(dialog); guideButton.onclick = () => dialog.showModal(); document.querySelector('#close-taxonomy').onclick = () => dialog.close();
  if (demo) document.querySelector('#reset-demo').onclick = () => { if (confirm('Clear this demo’s answers? This does not affect any study response.')) { localStorage.removeItem(api.key); for (const a of state.assignments) localStorage.removeItem(localKey(a.id)); location.reload(); } };
}

function sidebar() {
  const all = state.assignments.filter(a => a.mode === state.mode);
  const done = all.filter(a => a.status === 'submitted').length;
  document.querySelector('#sidebar-title').textContent = modeName(state.mode);
  document.querySelector('#workspace-title').textContent = modeName(state.mode);
  document.querySelector('#progress-count').textContent = `${done} / ${all.length}`;
  document.querySelector('#progress-fill').style.width = `${all.length ? 100 * done / all.length : 0}%`;
  document.querySelector('#case-nav').innerHTML = `<span class="eyebrow">YOUR ${all.length} CASES</span><div class="case-grid">${all.map(a => `<button class="case-chip ${a.id === state.item?.id ? 'active' : ''} ${a.status === 'submitted' ? 'complete' : ''}" data-case="${h(a.id)}" aria-label="Case ${a.ordinal}, ${a.status === 'submitted' ? 'submitted' : 'draft'}" ${a.id === state.item?.id ? 'aria-current="step"' : ''}>${String(a.ordinal).padStart(2, '0')}${a.status === 'submitted' ? '<span aria-hidden="true">✓</span>' : ''}</button>`).join('')}</div><div class="nav-legend"><span class="legend-square"></span>Submitted</div>`;
  for (const button of document.querySelectorAll('[data-case]')) button.onclick = () => navigate(button.dataset.case);
  const modes = [...new Set(state.assignments.map(a => a.mode))];
  document.querySelector('#mode-switch').innerHTML = modes.length > 1 ? `<label class="mode-label">Test workflow<select id="mode-select">${modes.map(m => `<option value="${m}" ${m === state.mode ? 'selected' : ''}>${modeName(m)}</option>`).join('')}</select></label>` : '';
  if (modes.length > 1) document.querySelector('#mode-select').onchange = async e => {
    try {
      await flush(); state.mode = e.target.value; const first = state.assignments.find(a => a.mode === state.mode);
      if (!hasReadGuide()) { sidebar(); showIntroduction(first); } else await openCase(first.id);
    } catch (err) { showError(err); }
  };
}

function rating(key, description, disabled = false) {
  const value = state.payload.ratings?.[key] ?? ''; const note = state.payload.notes?.[key] ?? '';
  return `<fieldset class="rating-field" ${disabled ? 'disabled' : ''}><legend>${qualityNames[key]}</legend><p>${description}</p><div class="choice-row">${[['acceptable', 'Acceptable'], ['needs_revision', 'Needs revision'], ['cannot_judge', 'Cannot judge']].map(([v, name]) => `<label class="choice"><input type="radio" name="${key}" value="${v}" data-rating="${key}" ${value === v ? 'checked' : ''}><span>${name}</span></label>`).join('')}</div>${noteField(key, value === 'needs_revision', note, disabled)}</fieldset>`;
}
function noteField(key, required, value = '', disabled = false) {
  return `<details class="note-field" data-note-details="${key}" ${required || value ? 'open' : ''}><summary>${required ? 'Brief explanation required' : 'Add a note (optional)'}</summary><label class="sr-only" for="note-${key}">Explanation for ${h(qualityNames[key] ?? key)}</label><textarea id="note-${key}" data-note="${key}" maxlength="2000" rows="2" ${disabled ? 'disabled' : ''} placeholder="A short explanation is enough. You can include a phrase from the document.">${h(value)}</textarea></details>`;
}
function annotations(gold) {
  const directions = [...new Set(gold.objectives.map(o => o.direction))];
  const decisions = [...new Set(gold.objectives.map(o => o.decision_type))];
  return `<div class="answer-sheet"><span class="eyebrow">INTENDED ANSWER SHEET</span><dl><div><dt>Nodes</dt><dd>${h(gold.node_meaning)}</dd></div><div><dt>Edges</dt><dd>${h(gold.edge_meaning)}</dd></div></dl><div class="objective-list">${gold.objectives.map((o, i) => {
    const family = taxonomy.families.find(f => f.objective_family_id === o.objective_family);
    return `<div class="objective"><span class="objective-number">${i + 1}</span><div><strong>${h(family?.name ?? familyNames[o.objective_family] ?? o.objective_family)}</strong><p class="objective-definition">${h(family?.definition ?? '')}</p><span>${o.direction === 'promote' ? 'Promote' : 'Reduce'} <span aria-hidden="true">·</span> ${decisionName(o.decision_type)}</span></div></div>`;
  }).join('')}</div><div class="tuple-definitions"><span class="eyebrow">DIRECTION AND DECISION LABELS</span><dl>${directions.map(key => `<div><dt>${key === 'promote' ? 'Promote' : 'Reduce'}</dt><dd>${h(taxonomy.directions[key])}</dd></div>`).join('')}${decisions.map(key => `<div><dt>${decisionName(key)}</dt><dd>${h(taxonomy.decision_types[key])}</dd></div>`).join('')}</dl></div><p class="helper">Judge whether the document reasonably supports these annotations. An implicit but understandable request is acceptable.</p></div>`;
}

function renderCase() {
  const item = state.item; const locked = item.status === 'submitted';
  const all = state.assignments.filter(a => a.mode === state.mode); const index = all.findIndex(a => a.id === item.id);
  let body;
  if (item.mode === 'absolute') {
    body = `<div class="absolute-layout"><article class="document-card"><div class="card-top"><span class="eyebrow">DOCUMENT</span><span class="pill">${h(genreNames[item.genre] ?? item.genre)}</span></div><div class="document-body">${renderDocument(item.documents[0].text)}</div></article><section class="assessment-card"><div class="section-heading"><span class="step">1</span><div><h2>Your first reading</h2><p>Read the document before viewing its annotations.</p></div></div>${rating('naturalness', 'Does this read like appropriate communication for its genre and audience?', locked || item.revealed)}${rating('realism', 'Does the actor’s decision and requested outcome make sense in this setting?', locked || item.revealed)}${item.revealed ? `<div class="phase-divider"><span class="step">2</span><div><h2>Check the intended modeling</h2><p>Your initial ratings are now locked.</p></div></div>${annotations(item.gold)}${rating('semantic_fidelity', 'Does the document reasonably support the listed node/edge meanings and objectives?', locked)}` : `<div class="reveal-panel"><span class="step">2</span><div><h2>Then check the answer sheet</h2><p>Choose both initial ratings, then reveal the intended annotations.</p><button id="reveal" class="button secondary">Reveal answer sheet <span aria-hidden="true">↓</span></button></div></div>`}</section></div>`;
  } else {
    const best = state.payload.preferences?.best ?? [];
    const missing = item.documents.some(d => !d.available);
    body = `<div class="comparison-intro"><p>Read the versions and choose the one that sounds most natural for this situation and genre. Trust your judgment; select multiple versions if they are equally natural.</p><div class="version-tabs" role="tablist" aria-label="Document versions">${item.documents.map((d, i) => `<button role="tab" id="tab-${d.label}" aria-controls="version-${d.label}" aria-selected="${i === 0}" data-tab="${d.label}">Version ${d.label}</button>`).join('')}</div></div><div class="version-grid">${item.documents.map((d, i) => `<article class="document-card version-card ${i === 0 ? 'mobile-active' : ''}" id="version-${d.label}" aria-labelledby="tab-${d.label}"><div class="card-top"><span class="version-badge">${d.label}</span><span class="pill">${h(genreNames[item.genre] ?? item.genre)}</span></div><div class="document-body">${d.available ? renderDocument(d.text) : '<div class="unavailable"><h3>Version unavailable</h3><p>No document was delivered for this version. Choose among the available versions, or select Cannot judge.</p></div>'}</div></article>`).join('')}</div><section class="comparative-ratings"><fieldset class="rating-field" ${locked ? 'disabled' : ''}><legend>Which version reads most naturally as a real document for this situation?</legend><p>Select one, or multiple versions if they are equally natural.</p>${missing ? '<p class="availability-note">One version is unavailable. Your choice compares only the available versions.</p>' : ''}<div class="choice-row">${[...item.documents.map(d => [d.label, `Version ${d.label}`, !d.available]), ['cannot_judge', 'Cannot judge', false]].map(([value, title, unavailable]) => `<label class="choice"><input type="checkbox" name="most-natural" data-best="${value}" value="${value}" ${best.includes(value) ? 'checked' : ''} ${unavailable ? 'disabled' : ''}><span>${title}</span></label>`).join('')}</div>${noteField('naturalness', false, state.payload.notes?.naturalness ?? '', locked)}</fieldset></section>`;
  }
  document.querySelector('#main').innerHTML = `<div class="case-heading"><div><span class="eyebrow">CASE ${String(item.ordinal).padStart(2, '0')} OF ${item.total}</span><h2>${item.mode === 'absolute' ? 'Review the document' : 'Compare the versions'}</h2></div><span class="case-state ${locked ? 'submitted' : ''}">${locked ? 'Submitted' : 'Draft'}</span></div><div id="case-messages" aria-live="polite"></div>${body}<div class="review-actions"><button id="previous" class="button quiet" ${index === 0 ? 'disabled' : ''}>← Previous case</button><div>${!locked ? '<button id="save-draft" class="button secondary">Save draft</button><button id="submit" class="button primary">Submit this case <span aria-hidden="true">✓</span></button>' : `<span class="submitted-note">${all.every(a => a.status === 'submitted') ? 'All assigned cases submitted. Thank you.' : 'Thank you. Your review is submitted.'}</span>`}<button id="next" class="button ${locked ? 'primary' : 'quiet'}" ${index === all.length - 1 ? 'disabled' : ''}>Next case →</button></div></div>`;
  sidebar(); showMessages(); updateSaveIndicator();
  if (!demo && item.is_test) document.querySelector('#test-banner').innerHTML = '<div class="test-banner">Test account · these responses are excluded from study results.</div>';
  document.querySelector('#previous').onclick = () => navigate(all[index - 1]?.id);
  document.querySelector('#next').onclick = () => navigate(all[index + 1]?.id);
  document.querySelector('#save-draft')?.addEventListener('click', () => flush().catch(showError));
  document.querySelector('#submit')?.addEventListener('click', submit);
  document.querySelector('#reveal')?.addEventListener('click', reveal);
  for (const input of document.querySelectorAll('[data-rating],[data-best],[data-note]')) input.addEventListener('input', change);
  for (const tab of document.querySelectorAll('[data-tab]')) tab.onclick = () => {
    for (const t of document.querySelectorAll('[data-tab]')) t.setAttribute('aria-selected', String(t === tab));
    for (const card of document.querySelectorAll('.version-card')) card.classList.toggle('mobile-active', card.id === `version-${tab.dataset.tab}`);
  };
}

function change(event) {
  if (state.item.status === 'submitted') return;
  const input = event.target; const { rating, best, note } = input.dataset;
  if (rating) { state.payload.ratings ??= {}; state.payload.ratings[rating] = input.value; }
  if (best) {
    state.payload.preferences ??= {};
    let selected = state.payload.preferences.best ?? [];
    if (best === 'cannot_judge') selected = input.checked ? ['cannot_judge'] : [];
    else selected = input.checked ? [...new Set([...selected.filter(v => v !== 'cannot_judge'), best])] : selected.filter(v => v !== best);
    state.payload.preferences.best = selected.sort();
    for (const choice of document.querySelectorAll('[data-best]')) choice.checked = selected.includes(choice.value);
  }
  if (note) { state.payload.notes ??= {}; state.payload.notes[note] = input.value; }
  const key = rating;
  if (key) {
    const details = document.querySelector(`[data-note-details="${key}"]`);
    const required = input.value === 'needs_revision';
    if (required) details.open = true;
    details.querySelector('summary').textContent = required ? 'Brief explanation required' : 'Add a note (optional)';
  }
  state.dirty = true; state.error = ''; state.saveState = 'pending'; stash(); showMessages(); updateSaveIndicator();
  clearTimeout(state.timer); state.timer = setTimeout(() => flush().catch(showError), 650);
}

function stash() {
  if (!state.item) return;
  try { localStorage.setItem(localKey(state.item.id), JSON.stringify({ payload: state.payload, revision: state.item.revision, pending: state.pending })); }
  catch { state.error = 'This browser could not keep a local draft. Keep this page open until the server confirms your save.'; }
}
function updateSaveIndicator() {
  const indicator = document.querySelector('#save-indicator'); if (!indicator) return;
  const labels = { idle: 'Ready', pending: 'Unsaved changes', saving: 'Saving…', saved: demo ? 'Saved in this browser' : 'Saved', error: 'Saved locally · upload pending' };
  indicator.className = `save-indicator ${state.saveState}`;
  indicator.innerHTML = `<span class="status-dot"></span><span>${labels[state.saveState]}</span>`;
}
function showMessages() {
  const target = document.querySelector('#case-messages'); if (!target) return;
  target.innerHTML = state.conflict ? `<div class="message warning"><strong>A newer draft was saved in another session.</strong><p>Your local changes are preserved. Choose which version to continue with.</p><button class="button secondary" id="use-server">Use server version</button><button class="button secondary" id="use-local">Keep this browser’s draft</button></div>` : state.error ? `<div class="message error" role="alert"><p>${h(state.error)}</p>${state.pending ? '<button class="button secondary" id="retry-save">Retry save</button>' : ''}</div>` : '';
  document.querySelector('#retry-save')?.addEventListener('click', () => { state.error = ''; flush().catch(showError); });
  document.querySelector('#use-server')?.addEventListener('click', () => resolveConflict(false));
  document.querySelector('#use-local')?.addEventListener('click', () => resolveConflict(true));
}
function showError(err) {
  state.error = err.message ?? String(err);
  if (state.pending) { state.saveState = 'error'; stash(); }
  showMessages(); updateSaveIndicator();
}

async function flush(submitRequest = false) {
  clearTimeout(state.timer);
  if (state.flushing) { await state.flushing; if (submitRequest) return flush(true); return; }
  if (!state.item || state.conflict) { if (state.conflict) throw new Error('Resolve the draft conflict before continuing.'); return; }
  if (state.item.status === 'submitted') return;
  let mustSubmit = submitRequest;
  state.flushing = (async () => {
    while (state.dirty || state.pending || mustSubmit) {
      state.pending ??= { id: state.item.id, payload: structuredClone(state.payload), revision: state.item.revision, requestId: crypto.randomUUID(), submit: mustSubmit };
      const request = state.pending; state.saveState = 'saving'; stash(); updateSaveIndicator();
      let remote;
      try { remote = await api.save(request.id, request.payload, request.revision, request.requestId, request.submit); }
      catch (err) {
        if (err.code === '40001') {
          const local = structuredClone(state.payload); const server = await api.get(request.id);
          state.conflict = { local, server }; state.pending = null;
        }
        throw err;
      }
      if (request.submit) mustSubmit = false;
      state.pending = null; state.item = remote;
      if (remote.status === 'submitted') state.payload = structuredClone(remote.payload);
      state.dirty = stableJSON(state.payload) !== stableJSON(remote.payload);
      const assignment = state.assignments.find(a => a.id === remote.id); assignment.status = remote.status; assignment.revision = remote.revision;
      if (state.dirty) stash(); else localStorage.removeItem(localKey(remote.id));
      if (remote.status === 'submitted') break;
    }
    state.error = ''; state.saveState = 'saved'; sidebar(); showMessages(); updateSaveIndicator();
  })();
  try { await state.flushing; } finally { state.flushing = null; }
}

async function resolveConflict(keepLocal) {
  const { local, server } = state.conflict; state.conflict = null; state.pending = null; state.item = server;
  state.payload = structuredClone(keepLocal ? local : server.payload); state.error = ''; state.dirty = keepLocal && stableJSON(local) !== stableJSON(server.payload);
  localStorage.removeItem(localKey(server.id)); renderCase(); if (state.dirty) { stash(); await flush().catch(showError); }
}

async function openCase(id) {
  const item = await api.get(id); state.item = item; state.mode = item.mode; state.pending = null; state.conflict = null;
  history.replaceState(null, '', `${location.pathname}${location.search}#${encodeURIComponent(id)}`);
  state.payload = Object.keys(item.payload ?? {}).length ? structuredClone(item.payload) : blankPayload(item.mode);
  state.dirty = false; state.error = ''; state.saveState = item.saved_at ? 'saved' : 'idle';
  let local; try { local = JSON.parse(localStorage.getItem(localKey(id))); } catch { local = null; }
  if (local && item.status !== 'submitted' && stableJSON(local.payload) !== stableJSON(item.payload)) {
    const acknowledged = local.pending && (local.pending.requestId === item.last_request_id || stableJSON(local.pending.payload) === stableJSON(item.payload));
    if (local.revision === item.revision || acknowledged) {
      state.payload = local.payload; state.dirty = true;
      state.pending = acknowledged ? null : local.pending; state.saveState = 'pending';
    } else state.conflict = { local: local.payload, server: item };
  } else if (local) localStorage.removeItem(localKey(id));
  renderCase(); document.querySelector('#main').focus({ preventScroll: true });
  if (state.dirty && !state.conflict) await flush().catch(showError);
}

async function navigate(id) {
  if (!hasReadGuide()) return;
  if (!id || state.navigating || id === state.item?.id) return;
  state.navigating = true;
  try { await flush(); await openCase(id); window.scrollTo({ top: 0, behavior: 'instant' }); }
  catch (err) { showError(err); }
  finally { state.navigating = false; }
}

async function reveal() {
  const ratings = state.payload.ratings ?? {};
  if (!ratings.naturalness || !ratings.realism) { showError(new Error('Choose a naturalness and realism response before revealing the answer sheet.')); return; }
  const button = document.querySelector('#reveal'); button.disabled = true;
  try { await flush(); state.item = await api.reveal(state.item.id, state.item.revision); state.payload = structuredClone(state.item.payload); renderCase(); document.querySelector('.answer-sheet').scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  catch (err) { showError(err); if (button.isConnected) button.disabled = false; }
}

async function submit() {
  const errors = validatePayload(state.item, state.payload);
  if (errors.length) { showError(new Error(errors.join(' '))); document.querySelector('#case-messages').scrollIntoView({ block: 'center' }); return; }
  const button = document.querySelector('#submit'); button.disabled = true; button.textContent = 'Submitting…';
  for (const input of document.querySelectorAll('#main input,#main textarea')) input.disabled = true;
  try { await flush(true); renderCase(); }
  catch (err) { renderCase(); showError(err); }
}

async function start() {
  const listing = await api.list(); state.assignments = listing.assignments;
  shell();
  if (!state.assignments.length) {
    document.querySelector('#main').innerHTML = '<section class="empty-card"><span class="eyebrow">YOU ARE SIGNED IN</span><h2>Your assignments are not ready yet.</h2><p>Please contact the study coordinator to link your account to a reviewer assignment. No response has been collected.</p><button class="button secondary" id="reload-assignments">Check again</button></section>';
    document.querySelector('#workspace-title').textContent = 'Review workspace'; document.querySelector('#reload-assignments').onclick = () => start().catch(showError); return;
  }
  const requested = decodeURIComponent(location.hash.slice(1));
  const first = state.assignments.find(a => a.id === requested) ?? state.assignments.find(a => a.status !== 'submitted') ?? state.assignments[0]; state.mode = first.mode;
  sidebar();
  if (!hasReadGuide()) showIntroduction(first); else await openCase(first.id);
}

window.addEventListener('online', () => { if (state.dirty || state.pending) flush().catch(showError); });
window.addEventListener('beforeunload', event => { if (state.dirty || state.pending) { stash(); event.preventDefault(); event.returnValue = ''; } });
if (demo || api.session()) start().catch(err => login(err.message)); else login();
