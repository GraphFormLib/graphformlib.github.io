GraphFormLib review workspace v1

Public website: dist/ only. Buildless HTML/CSS/ES modules; no dependency install is needed to serve it.
Live workspace: https://graphformlib.github.io/review/ (GitHub Pages enabled with author approval).

The two workflows are document quality (naturalness/realism first, then an answer-sheet reveal and semantic fidelity) and anonymous naturalness comparisons. Drafts autosave; server revision checks prevent silent cross-tab overwrites; saves carry idempotency IDs. Submitted items are locked. Offline drafts are retained locally and labelled upload pending, not server-saved.

Demo URLs: /review/?demo=absolute and /review/?demo=comparative.
Demo texts are illustrative fixtures, not study documents. Demo answers stay in the browser and are excluded from the study. Authenticated TEST assignments are also marked is_test and excluded from analysis.

Backend: Supabase Auth plus RPC functions over an unexposed private schema. No client role has direct access to its tables; all reviewer operations check the authenticated assignment. Gold annotations are returned only after initial ratings are saved and an explicit reveal is recorded. Comparative endpoints do not return gold or generation labels. Browser config contains only the supplied project URL and publishable key.

SETUP.txt explains dashboard and account steps. supabase/01_schema.sql and 02_test_seed.sql contain no real study data. The private/ directory contains generated actual-study SQL and must never be committed or deployed. Reviewer passwords, secret API keys, sessions, ratings, private mappings, and actual study texts must not be added to this repository's public files.

Study allocation: 54 cases, two separate groups of six anonymous reviewer slots, 18 cases per reviewer, two distinct reviewers per case per group. Comparative 18 cases means 54 variant presentations. Actual identities are not assigned by this source preparation.

The human rubric is a testable draft. Do not recruit reviewers or describe collected human evidence until the coordinator confirms the procedure. Missing baseline documents remain unavailable; affected comparisons allow Cannot judge only. They are not replaced with fabricated prose.

Tests: node --test tests/core.test.mjs; database and browser tests use developer-only tools outside the deploy directory. No model calls are made by this website.
