GraphFormLib review workspace v1

Public website: dist/ only. Buildless HTML/CSS/ES modules; no dependency install is needed to serve it.
Live workspace: https://graphformlib.github.io/review/ (GitHub Pages enabled with author approval).

Both workflows begin with a short introduction using verbatim definitions from objective-library-v3, remembered for this reviewer/browser and always reopenable. The answer sheet repeats canonical definitions and asks whether the document reasonably supports the listed annotations; it does not require proving uniqueness. See REVIEW_RUBRIC.txt.

The two workflows are document quality (naturalness/realism first, then an answer-sheet reveal and semantic fidelity) and one overall naturalness choice among anonymous versions (ties allowed; comments optional). Drafts autosave; server revision checks prevent silent cross-tab overwrites; saves carry idempotency IDs. Submitted items are locked. Offline drafts are retained locally and labelled upload pending, not server-saved.

Demo URLs: /review/?demo=absolute and /review/?demo=comparative.
Demo texts are illustrative fixtures, not study documents. Demo answers stay in the browser and are excluded from the study. Authenticated TEST assignments are also marked is_test and excluded from analysis.

Backend: Supabase Auth plus RPC functions over an unexposed private schema. No client role has direct access to its tables; all reviewer operations check the authenticated assignment. Gold annotations are returned only after initial ratings are saved and an explicit reveal is recorded. Comparative endpoints do not return gold or generation labels. Browser config contains only the supplied project URL and publishable key.

SETUP.txt explains dashboard and account steps. supabase/01_schema.sql and 02_test_seed.sql contain no real study data. The private/ directory contains generated actual-study SQL and must never be committed or deployed. Reviewer passwords, secret API keys, sessions, ratings, private mappings, and actual study texts must not be added to this repository's public files.

Study allocation: 54 cases, two separate groups of six anonymous reviewer slots, 18 cases per reviewer, two distinct reviewers per case per group. Comparative 18 cases means 54 variant presentations. Actual identities are not assigned by this source preparation.

The human rubric is a testable draft. Do not recruit reviewers or describe collected human evidence until the coordinator confirms the procedure. Missing baseline documents remain unavailable and cannot be selected; reviewers choose among available versions or Cannot judge. Analyse these cases separately from complete three-version choices. They are not replaced with fabricated prose.

Tests: node --test tests/core.test.mjs; database and browser tests use developer-only tools outside the deploy directory. No model calls are made by this website.

Comparative protocol v2: preferences.best stores one or several anonymous winning labels, or ["cannot_judge"]. This measures overall preference; it does not reconstruct both former pairwise comparisons. Existing installations apply supabase/03_overall_naturalness_v2.sql before collecting comparative responses. Fresh setup_test.sql already includes v2. See REVIEW_RUBRIC.txt for the dated amendment.

Deployment caching: index.html pins CSS and each browser module to a versioned asset URL. Bump that version when browser code changes. GitHub Pages can cache an older HTML response for 600 seconds; asset versioning stays internal. Shared reviewer URLs are clean; the app removes obsolete v query tags from old links while preserving demo selection and resume hashes.

Demo/test fixtures v3: three distinct assistant-written examples cover a documentation-navigation email, a water-maintenance team conversation and parcel-planning meeting notes, with 2/1/3 intended objectives. Anonymous version orders vary by case. These illustrative texts are not study documents or evidence of pipeline superiority. Each fixture has its own answer sheet. Old browser demo answers remain in their old namespace. The test-only database migration retains old fixture rows and refuses to replace answered test assignments.
