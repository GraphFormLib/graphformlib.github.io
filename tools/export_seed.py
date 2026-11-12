"""Prepare private SQL seeds from frozen review packets, without modifying them."""
from pathlib import Path
from collections import Counter
import argparse
import hashlib
import json
import subprocess
import uuid

SITE = Path(__file__).resolve().parents[1]
ROOT = SITE.parents[1]
NAMESPACE = uuid.UUID('c78ca076-4442-4a45-8dd2-7631b8820a80')


def load(p):
    return json.loads(p.read_text())


def uid(s):
    return str(uuid.uuid5(NAMESPACE, s))


def sql_seed(data):
    encoded = json.dumps(data, ensure_ascii=False)
    tag = '$seed_' + hashlib.sha256(encoded.encode()).hexdigest()[:12] + '$'
    assert tag not in encoded
    return f'''-- Private study import. Do not commit this file or publish it with the website.
begin;
do $import$
declare data jsonb := {tag}{encoded}{tag}::jsonb;
begin
  insert into review_private.reviewers(reviewer_code,review_mode,is_test)
    select reviewer_code,review_mode,is_test from jsonb_to_recordset(data->'reviewers')
      as x(reviewer_code text,review_mode text,is_test boolean)
    on conflict(reviewer_code) do nothing;
  insert into review_private.cases(case_id,study_version,genre,gold,variants,provenance,is_test)
    select case_id,study_version,genre,gold,variants,provenance,is_test from jsonb_to_recordset(data->'cases')
      as x(case_id uuid,study_version text,genre text,gold jsonb,variants jsonb,provenance jsonb,is_test boolean)
    on conflict(case_id) do nothing;
  if exists(select 1 from jsonb_to_recordset(data->'cases') as x(case_id uuid,gold jsonb,variants jsonb)
    join review_private.cases c using(case_id) where c.gold<>x.gold or c.variants<>x.variants) then
    raise exception 'Existing case differs from frozen import. Preserve its version and responses.';
  end if;
  insert into review_private.assignments(assignment_id,reviewer_code,case_id,ordinal,variant_order)
    select assignment_id,reviewer_code,case_id,ordinal,variant_order from jsonb_to_recordset(data->'assignments')
      as x(assignment_id uuid,reviewer_code text,case_id uuid,ordinal integer,variant_order jsonb)
    on conflict(assignment_id) do nothing;
  if exists(select 1 from jsonb_to_recordset(data->'assignments') as x(assignment_id uuid,reviewer_code text,case_id uuid,ordinal integer,variant_order jsonb)
    join review_private.assignments a using(assignment_id)
    where a.reviewer_code<>x.reviewer_code or a.case_id<>x.case_id or a.ordinal<>x.ordinal or a.variant_order<>x.variant_order) then
    raise exception 'Existing assignment differs from frozen import.';
  end if;
end $import$;
commit;
'''


def test_seed():
    source = SITE / 'dist/review/demo.js'
    command = ['node', '--input-type=module', '-e', f"import {{demoSeed}} from {json.dumps(source.as_uri())}; process.stdout.write(JSON.stringify(demoSeed));"]
    fixture = json.loads(subprocess.check_output(command, text=True))
    reviewers = [dict(reviewer_code='TEST-A', review_mode='absolute', is_test=True), dict(reviewer_code='TEST-C', review_mode='comparative', is_test=True)]
    cases = []; assignments = []
    for n in range(1, 4):
        cid = uid(f'test-case-{n}')
        cases.append(dict(case_id=cid, study_version='interface-test-v1', genre='operational_email', **fixture, provenance={'fixture': True}, is_test=True))
        for r in reviewers:
            assignments.append(dict(assignment_id=uid(f"test-{r['reviewer_code']}-{n}"), reviewer_code=r['reviewer_code'], case_id=cid, ordinal=n,
                                    variant_order=['writer_only', 'minimal_one_shot', 'full_pipeline']))
    return dict(reviewers=reviewers, cases=cases, assignments=assignments)


def study_seed(study, packets):
    manifest = load(packets / 'manifest.json')
    for entry in manifest['files']:
        assert hashlib.sha256((packets / entry['path']).read_bytes()).hexdigest() == entry['sha256']
    original = ROOT / 'results/authoring_ablation_54_v1/human_review_draft_v1_20261112/private'
    absolute = {r['document_id']: r for r in load(original / 'absolute_assignments.json')}
    comparative = {r['document_id']: r for r in load(original / 'comparative_assignments.json')}
    selected = {r['slot_id']: r for r in load(study / 'SELECTION.json')['selected']}
    entries = {(r['slot_id'], r['condition']): r for r in load(study / 'EVALUATION.json')['entries']}
    cases = []
    for slot, row in selected.items():
        variants = {}
        for condition in ['minimal_one_shot', 'writer_only', 'full_pipeline']:
            item = entries[slot, condition]
            if item['story_id'] is None:
                variants[condition] = dict(text=None, available=False)
            else:
                p = study / 'items' / item['story_id'] / 'story.txt'
                assert hashlib.sha256(p.read_bytes()).hexdigest() == item['story_sha256']
                variants[condition] = dict(text=p.read_text(), available=True)
        cases.append(dict(case_id=uid(slot), study_version='authoring54-human-review-v3', genre=row['genre_id'],
                          gold=load(study / 'cases' / slot / 'gold.json'), variants=variants,
                          provenance=dict(slot_id=slot, text_freeze_sha256=hashlib.sha256((study / 'EVALUATION.json').read_bytes()).hexdigest()), is_test=False))
    plan = load(packets / 'private/PLANNED_ASSIGNMENTS.json')
    reviewers = []; assignments = []
    for person in plan['reviewers']:
        code = person['placeholder']; mode = 'absolute' if person['group'] == 'absolute_quality' else 'comparative'
        reviewers.append(dict(reviewer_code=code, review_mode=mode, is_test=False))
        packet = load(packets / person['group'] / code / 'PACKET.json')
        if mode == 'absolute':
            rows = [(absolute[x['document_id']]['slot_id'], ['minimal_one_shot', 'writer_only', 'full_pipeline']) for x in packet['items']]
        else:
            rows = []
            for p in packet['case_preferences']:
                ids = [comparative[x] for x in p['document_ids']]
                assert len({r['slot_id'] for r in ids}) == 1
                rows.append((ids[0]['slot_id'], [r['condition'] for r in ids]))
        assert len(rows) == 18
        for ordinal, (slot, order) in enumerate(rows, 1):
            assignments.append(dict(assignment_id=uid(f'{code}:{slot}'), reviewer_code=code, case_id=uid(slot), ordinal=ordinal, variant_order=order))
    counts = Counter((a['case_id'], 'absolute' if a['reviewer_code'].startswith('A') else 'comparative') for a in assignments)
    assert len(cases) == 54 and len(reviewers) == 12 and len(assignments) == 216 and set(counts.values()) == {2}
    return dict(reviewers=reviewers, cases=cases, assignments=assignments)


def main():
    global ROOT
    p = argparse.ArgumentParser(); p.add_argument('--study', type=Path); p.add_argument('--packets', type=Path)
    p.add_argument('--workspace', type=Path, help='Original wrap-up workspace containing frozen sources')
    args = p.parse_args()
    if args.workspace:
        ROOT = args.workspace.resolve()
    demo = test_seed()
    (SITE / 'supabase/02_test_seed.sql').write_text(sql_seed(demo))
    private = SITE / 'private'; private.mkdir(exist_ok=True)
    (private / 'test-seed.json').write_text(json.dumps(demo, indent=2) + '\n')
    if args.study:
        assert args.packets
        data = study_seed(args.study.resolve(), args.packets.resolve())
        (private / '03_study_seed.sql').write_text(sql_seed(data))
        (private / 'study-seed.json').write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
        (private / 'SETUP_ALL.sql').write_text((SITE / 'supabase/01_schema.sql').read_text() + '\n' + sql_seed(demo) + '\n' + sql_seed(data))
        print(json.dumps({'cases': len(data['cases']), 'assignments': len(data['assignments']), 'reviewers': len(data['reviewers']), 'ratings': 0, 'unavailable_versions': sum(not v['available'] for c in data['cases'] for v in c['variants'].values())}))
    else:
        (private / 'SETUP_TEST.sql').write_text((SITE / 'supabase/01_schema.sql').read_text() + '\n' + sql_seed(demo))


if __name__ == '__main__':
    main()
