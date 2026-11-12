-- Run privately in the SQL editor; download the result as CSV.
-- This includes drafts for backup. Use status='submitted' for analysis.
-- It intentionally excludes authentication identities and all TEST fixtures.
select r.reviewer_code,r.review_mode,a.ordinal,a.assignment_id,c.study_version,
  c.provenance,c.genre,c.gold,a.variant_order,
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
