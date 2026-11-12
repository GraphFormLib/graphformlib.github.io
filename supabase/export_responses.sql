-- Run privately in the SQL editor; download the result as CSV.
-- This includes drafts for backup. Use status='submitted' for analysis.
-- It intentionally excludes authentication identities and all TEST fixtures.
select r.reviewer_code,r.review_mode,a.ordinal,a.assignment_id,c.study_version,
  c.provenance,c.genre,c.gold,a.variant_order,
  case when r.review_mode='absolute' then 'document-quality-v1'
    when s.payload->'preferences' ? 'p1' then 'pairwise-naturalness-v1'
    else 'overall-naturalness-v2' end as review_protocol,
  s.payload->'preferences'->'best' as most_natural_versions,
  (select coalesce(jsonb_agg(a.variant_order->>(ascii(x.value)-ascii('A'))),'[]'::jsonb)
   from jsonb_array_elements_text(case when jsonb_typeof(s.payload->'preferences'->'best')='array'
     then s.payload->'preferences'->'best' else '[]'::jsonb end) x(value)
   where x.value in ('A','B','C')) as most_natural_conditions,
  (select jsonb_agg(jsonb_build_object('label',chr(64+x.ordinal::int),'available',
     coalesce((c.variants->x.value->>'available')::boolean,false)))
   from jsonb_array_elements_text(a.variant_order) with ordinality x(value,ordinal)) as version_availability,
  s.status,s.payload,s.revision,s.pre_reveal_ratings,s.revealed_at,s.saved_at,s.submitted_at
from review_private.responses s
join review_private.assignments a using(assignment_id)
join review_private.reviewers r using(reviewer_code)
join review_private.cases c using(case_id)
where not r.is_test and not c.is_test
order by r.reviewer_code,a.ordinal;

-- Optional complete revision history, also private and excluding TEST fixtures.
select r.reviewer_code,r.review_mode,a.assignment_id,c.provenance,
  e.revision,e.event_type,e.payload,e.happened_at
from review_private.events e
join review_private.assignments a using(assignment_id)
join review_private.reviewers r using(reviewer_code)
join review_private.cases c using(case_id)
where not r.is_test and not c.is_test
order by r.reviewer_code,a.ordinal,e.revision;
