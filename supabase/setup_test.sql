-- GraphFormLib: single-script TEST setup with three distinct illustrative cases.
-- GraphFormLib review workspace v1. Run in the Supabase SQL editor.
-- No study documents, passwords or administrative API keys belong in the public site.
begin;
create schema if not exists review_private;
revoke all on schema review_private from public, anon, authenticated;

create table if not exists review_private.reviewers (
  reviewer_code text primary key,
  review_mode text not null check (review_mode in ('absolute','comparative')),
  auth_user_id uuid references auth.users(id),
  is_test boolean not null default false,
  enabled boolean not null default true
);
create unique index if not exists one_production_identity_per_reviewer
  on review_private.reviewers(auth_user_id) where not is_test;
create table if not exists review_private.cases (
  case_id uuid primary key,
  study_version text not null,
  genre text not null,
  gold jsonb not null,
  variants jsonb not null,
  provenance jsonb not null default '{}'::jsonb,
  is_test boolean not null default false
);
create table if not exists review_private.assignments (
  assignment_id uuid primary key,
  reviewer_code text not null references review_private.reviewers(reviewer_code),
  case_id uuid not null references review_private.cases(case_id),
  ordinal integer not null check(ordinal > 0),
  variant_order jsonb not null check(jsonb_typeof(variant_order)='array'),
  unique(reviewer_code,case_id), unique(reviewer_code,ordinal)
);
create table if not exists review_private.responses (
  assignment_id uuid primary key references review_private.assignments(assignment_id),
  payload jsonb not null default '{}'::jsonb,
  revision integer not null default 0,
  last_request_id uuid,
  status text not null default 'draft' check(status in ('draft','submitted')),
  revealed_at timestamptz,
  pre_reveal_ratings jsonb,
  saved_at timestamptz,
  submitted_at timestamptz
);
create table if not exists review_private.events (
  event_id bigint generated always as identity primary key,
  assignment_id uuid not null references review_private.assignments(assignment_id),
  revision integer not null,
  event_type text not null,
  payload jsonb not null,
  happened_at timestamptz not null default now()
);
alter table review_private.reviewers enable row level security;
alter table review_private.cases enable row level security;
alter table review_private.assignments enable row level security;
alter table review_private.responses enable row level security;
alter table review_private.events enable row level security;
revoke all on all tables in schema review_private from public,anon,authenticated;
revoke all on all sequences in schema review_private from public,anon,authenticated;

create or replace function review_private.require_assignment(p_id uuid)
returns review_private.assignments language plpgsql security definer set search_path='' as $$
declare a review_private.assignments;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  select x.* into a from review_private.assignments x
    join review_private.reviewers r on r.reviewer_code=x.reviewer_code
    where x.assignment_id=p_id and r.auth_user_id=auth.uid() and r.enabled;
  if not found then raise exception 'Assignment unavailable' using errcode='42501'; end if;
  return a;
end $$;

create or replace function public.review_list_assignments()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.assignment_id,'mode',r.review_mode,'ordinal',a.ordinal,'genre',c.genre,
    'status',coalesce(s.status,'draft'),'revision',coalesce(s.revision,0),
    'saved_at',s.saved_at,'is_test',r.is_test
  ) order by r.review_mode,a.ordinal),'[]'::jsonb) into result
  from review_private.assignments a
  join review_private.reviewers r on r.reviewer_code=a.reviewer_code
  join review_private.cases c on c.case_id=a.case_id
  left join review_private.responses s on s.assignment_id=a.assignment_id
  where r.auth_user_id=auth.uid() and r.enabled;
  return jsonb_build_object('assignments',result);
end $$;

create or replace function public.review_get_case(p_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a review_private.assignments; c review_private.cases; s review_private.responses;
  r review_private.reviewers; docs jsonb:='[]'::jsonb;
  kind text; i integer:=0; order_names text[]; total integer;
begin
  a:=review_private.require_assignment(p_assignment_id);
  select * into c from review_private.cases where case_id=a.case_id;
  select * into r from review_private.reviewers where reviewer_code=a.reviewer_code;
  select * into s from review_private.responses where assignment_id=a.assignment_id;
  select count(*) into total from review_private.assignments where reviewer_code=a.reviewer_code;
  if r.review_mode='absolute' then
    docs:=jsonb_build_array(jsonb_build_object('label','Document','text',c.variants->'full_pipeline'->>'text','available',true));
  else
    select array_agg(value order by ord) into order_names from jsonb_array_elements_text(a.variant_order) with ordinality x(value,ord);
    foreach kind in array order_names loop
      i:=i+1;
      docs:=docs||jsonb_build_array(jsonb_build_object('label',chr(64+i),
        'text',c.variants->kind->>'text','available',coalesce((c.variants->kind->>'available')::boolean,false)));
    end loop;

  end if;
  return jsonb_build_object('id',a.assignment_id,'mode',r.review_mode,'ordinal',a.ordinal,'total',total,
    'genre',c.genre,'documents',docs,'review_protocol',case when r.review_mode='absolute' then 'document-quality-v1' else 'overall-naturalness-v2' end,'is_test',r.is_test,
    'revision',coalesce(s.revision,0),'status',coalesce(s.status,'draft'),
    'payload',coalesce(s.payload,'{}'::jsonb),'last_request_id',s.last_request_id,'revealed',s.revealed_at is not null,
    'gold',case when r.review_mode='absolute' and s.revealed_at is not null then c.gold else null end,
    'saved_at',s.saved_at,'submitted_at',s.submitted_at);
end $$;

create or replace function review_private.validate_payload(p_mode text,p jsonb,p_submit boolean,p_revealed boolean)
returns void language plpgsql security definer set search_path='' as $$
declare k text; v text; note text; best jsonb;
begin
  if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>20000 then
    raise exception 'Invalid response' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(p) x where x not in ('ratings','preferences','notes')) then
    raise exception 'Unexpected response field' using errcode='22023';
  end if;
  if p?'notes' and jsonb_typeof(p->'notes')<>'object' then raise exception 'Invalid notes' using errcode='22023'; end if;
  if exists(select 1 from jsonb_each(coalesce(p->'notes','{}'::jsonb)) x where jsonb_typeof(x.value)<>'string' or length(x.value#>>'{}')>2000) then
    raise exception 'Notes must be text, at most 2000 characters' using errcode='22023';
  end if;
  if p_mode='absolute' then
    if p?'preferences' or (p?'ratings' and jsonb_typeof(p->'ratings')<>'object') then raise exception 'Invalid ratings' using errcode='22023'; end if;
    if exists(select 1 from jsonb_object_keys(coalesce(p->'ratings','{}'::jsonb)) x where x not in ('naturalness','realism','semantic_fidelity')) then raise exception 'Unknown rating' using errcode='22023'; end if;
    foreach k in array array['naturalness','realism','semantic_fidelity'] loop
      v:=coalesce(p->'ratings'->>k,''); note:=coalesce(p->'notes'->>k,'');
      if v not in ('','acceptable','needs_revision','cannot_judge') then raise exception 'Invalid rating choice' using errcode='22023'; end if;
      if k='semantic_fidelity' and v<>'' and not p_revealed then raise exception 'Reveal the answer sheet first' using errcode='22023'; end if;
      if p_submit and v='' then raise exception 'Complete all three ratings' using errcode='22023'; end if;
      if p_submit and v='needs_revision' and length(btrim(note))=0 then raise exception 'Explain the requested revision' using errcode='22023'; end if;
    end loop;
    if p_submit and not p_revealed then raise exception 'Answer sheet review required' using errcode='22023'; end if;
  else
    if p?'ratings' or (p?'preferences' and jsonb_typeof(p->'preferences')<>'object') then raise exception 'Invalid preferences' using errcode='22023'; end if;
    if exists(select 1 from jsonb_object_keys(coalesce(p->'preferences','{}'::jsonb)) x where x<>'best') then raise exception 'Unknown preference field' using errcode='22023'; end if;
    best:=coalesce(p->'preferences'->'best','[]'::jsonb);
    if jsonb_typeof(best)<>'array' then raise exception 'Select versions as a list' using errcode='22023'; end if;
    if exists(select 1 from jsonb_array_elements(best) x where jsonb_typeof(x)<>'string' or x#>>'{}' not in ('A','B','C','cannot_judge')) then
      raise exception 'Invalid version choice' using errcode='22023';
    end if;
    if (select count(*)<>count(distinct value) from jsonb_array_elements_text(best))
      or (best ? 'cannot_judge' and jsonb_array_length(best)<>1) then
      raise exception 'Choose versions, or Cannot judge on its own' using errcode='22023';
    end if;
    if p_submit and jsonb_array_length(best)=0 then raise exception 'Choose the most natural version, tied versions, or Cannot judge' using errcode='22023'; end if;
  end if;
end $$;

create or replace function review_private.mutate(p_assignment_id uuid,p_payload jsonb,p_revision integer,p_request_id uuid,p_submit boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a review_private.assignments; s review_private.responses; r review_private.reviewers; c review_private.cases;
  k text; v text; selected_kind text;
begin
  a:=review_private.require_assignment(p_assignment_id);
  perform 1 from review_private.assignments where assignment_id=a.assignment_id for update;
  select * into r from review_private.reviewers where reviewer_code=a.reviewer_code;
  select * into c from review_private.cases where case_id=a.case_id;
  insert into review_private.responses(assignment_id) values(a.assignment_id) on conflict do nothing;
  select * into s from review_private.responses where assignment_id=a.assignment_id;
  if p_request_id is null then raise exception 'Request identifier required' using errcode='22023'; end if;
  if s.last_request_id=p_request_id then return public.review_get_case(a.assignment_id); end if;
  if s.status='submitted' then raise exception 'This review has already been submitted' using errcode='22023'; end if;
  if p_revision is distinct from s.revision then raise exception 'A newer response is saved. Reload this case before editing.' using errcode='40001'; end if;
  perform review_private.validate_payload(r.review_mode,p_payload,p_submit,s.revealed_at is not null);
  if s.revealed_at is not null then
    foreach k in array array['naturalness','realism'] loop
      if (p_payload->'ratings'->>k) is distinct from (s.pre_reveal_ratings->>k) then
        raise exception 'Initial ratings are locked after revealing answers' using errcode='22023';
      end if;
    end loop;
  end if;
  if r.review_mode='comparative' then
    for v in select value from jsonb_array_elements_text(coalesce(p_payload->'preferences'->'best','[]'::jsonb)) loop
      if v<>'cannot_judge' then
        selected_kind:=a.variant_order->>(ascii(v)-ascii('A'));
        if selected_kind is null or not coalesce((c.variants->selected_kind->>'available')::boolean,false) then
          raise exception 'An unavailable version cannot be selected' using errcode='22023';
        end if;
      end if;
    end loop;
  end if;
  update review_private.responses set payload=p_payload,revision=revision+1,last_request_id=p_request_id,
    status=case when p_submit then 'submitted' else 'draft' end,saved_at=now(),
    submitted_at=case when p_submit then now() else null end where assignment_id=a.assignment_id;
  insert into review_private.events(assignment_id,revision,event_type,payload)
    values(a.assignment_id,s.revision+1,case when p_submit then 'submit' else 'save' end,p_payload);
  return public.review_get_case(a.assignment_id);
end $$;

create or replace function public.review_save_draft(p_assignment_id uuid,p_payload jsonb,p_revision integer,p_request_id uuid)
returns jsonb language sql security definer set search_path='' as $$
  select review_private.mutate(p_assignment_id,p_payload,p_revision,p_request_id,false);
$$;
create or replace function public.review_submit_case(p_assignment_id uuid,p_payload jsonb,p_revision integer,p_request_id uuid)
returns jsonb language sql security definer set search_path='' as $$
  select review_private.mutate(p_assignment_id,p_payload,p_revision,p_request_id,true);
$$;

create or replace function public.review_reveal_key(p_assignment_id uuid,p_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a review_private.assignments; s review_private.responses; mode text;
begin
  a:=review_private.require_assignment(p_assignment_id);
  perform 1 from review_private.assignments where assignment_id=a.assignment_id for update;
  select review_mode into mode from review_private.reviewers where reviewer_code=a.reviewer_code;
  if mode<>'absolute' then raise exception 'Answer sheets are unavailable for comparison reviews' using errcode='42501'; end if;
  select * into s from review_private.responses where assignment_id=a.assignment_id;
  if s.revealed_at is not null then return public.review_get_case(a.assignment_id); end if;
  if s.revision is null or s.revision is distinct from p_revision then raise exception 'Save initial ratings before revealing answers' using errcode='40001'; end if;
  if coalesce(s.payload->'ratings'->>'naturalness','') not in ('acceptable','needs_revision','cannot_judge')
    or coalesce(s.payload->'ratings'->>'realism','') not in ('acceptable','needs_revision','cannot_judge') then
    raise exception 'Rate naturalness and realism first' using errcode='22023';
  end if;
  update review_private.responses set revealed_at=now(),pre_reveal_ratings=s.payload->'ratings',revision=revision+1,saved_at=now()
    where assignment_id=a.assignment_id;
  insert into review_private.events(assignment_id,revision,event_type,payload) values(a.assignment_id,s.revision+1,'reveal',s.payload);
  return public.review_get_case(a.assignment_id);
end $$;

create or replace function public.review_admin_bind_account(p_reviewer_code text,p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from review_private.reviewers r where r.reviewer_code=p_reviewer_code
      and not r.is_test and r.auth_user_id is not null and r.auth_user_id<>p_user_id
      and exists(select 1 from review_private.assignments a join review_private.events e using(assignment_id) where a.reviewer_code=r.reviewer_code)) then
    raise exception 'Reviewer identity is locked after responses. Preserve its provenance.';
  end if;
  update review_private.reviewers set auth_user_id=p_user_id where reviewer_code=p_reviewer_code;
  if not found then raise exception 'Unknown reviewer code'; end if;
end $$;

revoke all on all functions in schema review_private from public,anon,authenticated;
revoke all on function public.review_list_assignments() from public,anon;
revoke all on function public.review_get_case(uuid) from public,anon;
revoke all on function public.review_save_draft(uuid,jsonb,integer,uuid) from public,anon;
revoke all on function public.review_submit_case(uuid,jsonb,integer,uuid) from public,anon;
revoke all on function public.review_reveal_key(uuid,integer) from public,anon;
revoke all on function public.review_admin_bind_account(text,uuid) from public,anon,authenticated;
grant execute on function public.review_list_assignments() to authenticated;
grant execute on function public.review_get_case(uuid) to authenticated;
grant execute on function public.review_save_draft(uuid,jsonb,integer,uuid) to authenticated;
grant execute on function public.review_submit_case(uuid,jsonb,integer,uuid) to authenticated;
grant execute on function public.review_reveal_key(uuid,integer) to authenticated;
grant execute on function public.review_admin_bind_account(text,uuid) to service_role;
notify pgrst,'reload schema';
commit;

-- Private study import. Do not commit this file or publish it with the website.
begin;
do $import$
declare data jsonb := $seed_29210006dd1a${"reviewers": [{"reviewer_code": "TEST-A", "review_mode": "absolute", "is_test": true}, {"reviewer_code": "TEST-C", "review_mode": "comparative", "is_test": true}], "cases": [{"case_id": "282ce738-0ff4-59d7-ae6a-6d684d076b5b", "study_version": "interface-test-v3", "genre": "operational_email", "gold": {"node_meaning": "web page", "edge_meaning": "one page contains a direct hyperlink to another page", "objectives": [{"objective_family": "centrality", "direction": "promote", "decision_type": "graph_object_selection"}, {"objective_family": "path_distance", "direction": "reduce", "decision_type": "graph_object_selection"}]}, "variants": {"full_pipeline": {"text": "Subject: Navigation example for Thursday's review\n\nHi Sam,\n\nCould you choose one of the existing documentation-site examples for Thursday's navigation review? The shared folder has the page lists and direct hyperlinks for each example.\n\nWe'd like the overview page to do more work as an intermediary: more of the shortest click routes between other pages should pass through it. We'd also like a short route from the installation page to the troubleshooting page, using as few successive clicks as possible. Please consider both preferences when recommending an example.\n\nSend the example name and a brief explanation before the meeting. We'll use your recommendation to guide the discussion.\n\nThanks,\nAlex", "available": true}, "writer_only": {"text": "Subject: Example for the navigation review\n\nHi Sam,\n\nPlease select one existing documentation-site example from our shortlist. The shared records identify its pages and the direct hyperlinks between them.\n\nFor the review, we want an example whose overview page is an intermediary on more of the shortest click routes between other pages. We also want the shortest route from the installation page to troubleshooting to require fewer successive clicks. Both criteria should influence your selection.\n\nPlease send the example name with a short explanation of how it meets those two preferences.\n\nThanks,\nAlex", "available": true}, "minimal_one_shot": {"text": "Navigation review request\n\nSelect one existing documentation-site example. Nodes represent pages and directed edges represent direct hyperlinks. The objectives are to promote the centrality of the overview page and reduce path distance from installation to troubleshooting. Centrality is assessed by the overview page's intermediary role on shortest paths between other pages. Distance counts successive hyperlinks.\n\nUse both objectives to choose the example and report the choice with a brief rationale.", "available": true}}, "provenance": {"fixture": true, "fixture_id": "documentation-navigation", "fixture_version": 3}, "is_test": true}, {"case_id": "ccbafba7-8f4d-565c-8fa7-d83eacaa36eb", "study_version": "interface-test-v3", "genre": "team_conversation", "gold": {"node_meaning": "pipe junction", "edge_meaning": "a pipe section directly connects two junctions", "objectives": [{"objective_family": "robustness", "direction": "promote", "decision_type": "graph_intervention"}]}, "variants": {"full_pipeline": {"text": "Maya: We need the next round of backup-pipe proposals before Friday. The maintenance map shows the junctions and the pipe sections running between them.\n\nOwen: Are we looking at the north district again?\n\nMaya: Yes. Closing the section near Pine Street last month left several junctions cut off from the pumping station. I'd like you to propose additional pipe connections that would let us keep the district connected while any one existing section is closed for repairs.\n\nOwen: I'll compare a few layouts against each possible single-section closure and bring the most resilient option to the meeting.\n\nMaya: Great. Please mark the proposed connections on the map so the maintenance team can discuss where they could go.", "available": true}, "writer_only": {"text": "Maya: Please propose additional pipe connections for the north district. Our maintenance map records pipe junctions and the pipe sections directly connecting them.\n\nOwen: What should I prioritize?\n\nMaya: Improving resilience to a single pipe-section closure. More junctions should remain connected to the pumping station when any one existing section is closed for maintenance.\n\nOwen: I'll compare the proposed layouts under those closures and recommend the most resilient one by Friday.", "available": true}, "minimal_one_shot": {"text": "Maya: Model the district as junction nodes with undirected pipe-section edges. Propose additional edges to promote robustness against a single existing-edge closure.\n\nOwen: I will compare candidate interventions by how well junctions retain connectivity to the pumping station after each possible closure and recommend a layout.", "available": true}}, "provenance": {"fixture": true, "fixture_id": "water-maintenance", "fixture_version": 3}, "is_test": true}, {"case_id": "2e6a95df-a2d4-57bc-822e-df2ede4a55b2", "study_version": "interface-test-v3", "genre": "meeting_notes", "gold": {"node_meaning": "parcel depot", "edge_meaning": "a scheduled direct overnight transfer service from one depot to another", "objectives": [{"objective_family": "reachability", "direction": "promote", "decision_type": "graph_intervention"}, {"objective_family": "path_distance", "direction": "reduce", "decision_type": "graph_intervention"}, {"objective_family": "robustness", "direction": "promote", "decision_type": "graph_intervention"}]}, "variants": {"full_pipeline": {"text": "## Regional parcel operations — planning meeting\n\n**Attendees:** Lena, Samir, Jo\n\nThe team reviewed the overnight transfer schedule. Each entry names the sending depot and the receiving depot for a direct service. Two eastern depots still cannot be reached by following the scheduled transfers from Riverside.\n\nThe next proposal will add direct services to the existing schedule. The team agreed on three priorities:\n- Give parcels leaving Riverside a transfer route to every depot in the region.\n- Reduce the number of depot-to-depot handoffs on the Riverside-to-Harbor journey.\n- Keep more depots reachable from Riverside when any single scheduled service is cancelled.\n\nSamir will compare the proposed schedules against all three priorities. Jo will check which additional services the carriers could operate. The team will choose a proposal at next Tuesday's meeting.", "available": true}, "writer_only": {"text": "## Regional parcel planning notes\n\nThe overnight schedule lists direct transfers from sending depots to receiving depots. The team will add services to improve the schedule.\n\nThe proposal should achieve three objectives: expand the set of depots reachable from Riverside, shorten the Riverside-to-Harbor journey in number of successive transfers, and improve the retention of depot access from Riverside after any one scheduled service is cancelled.\n\nSamir will assess the proposals against all three criteria. Jo will check operational feasibility. A recommendation is due next Tuesday.", "available": true}, "minimal_one_shot": {"text": "## Parcel network planning\n\nNodes are depots. A directed edge is a scheduled direct overnight transfer. The decision is a graph intervention: add direct services.\n\nObjectives:\n- Promote reachability from Riverside.\n- Reduce shortest-path distance, measured in transfers, from Riverside to Harbor.\n- Promote robustness of reachability from Riverside under any single service cancellation.\n\nCompare the proposals on these three objectives and recommend one for Tuesday.", "available": true}}, "provenance": {"fixture": true, "fixture_id": "parcel-transfers", "fixture_version": 3}, "is_test": true}], "assignments": [{"assignment_id": "6c90807a-4923-5a06-844d-baa62f123ddd", "reviewer_code": "TEST-A", "case_id": "282ce738-0ff4-59d7-ae6a-6d684d076b5b", "ordinal": 1, "variant_order": ["writer_only", "minimal_one_shot", "full_pipeline"]}, {"assignment_id": "7af90e10-7d3d-5b38-a655-c914c42be6f8", "reviewer_code": "TEST-C", "case_id": "282ce738-0ff4-59d7-ae6a-6d684d076b5b", "ordinal": 1, "variant_order": ["writer_only", "minimal_one_shot", "full_pipeline"]}, {"assignment_id": "10e1bdc7-e32a-59cf-ba72-5ee1e2a131df", "reviewer_code": "TEST-A", "case_id": "ccbafba7-8f4d-565c-8fa7-d83eacaa36eb", "ordinal": 2, "variant_order": ["full_pipeline", "writer_only", "minimal_one_shot"]}, {"assignment_id": "75bd8e65-ab21-5359-aad0-e611df7505cc", "reviewer_code": "TEST-C", "case_id": "ccbafba7-8f4d-565c-8fa7-d83eacaa36eb", "ordinal": 2, "variant_order": ["full_pipeline", "writer_only", "minimal_one_shot"]}, {"assignment_id": "f74f5d9d-fbc0-584b-9aac-a4488c0605d5", "reviewer_code": "TEST-A", "case_id": "2e6a95df-a2d4-57bc-822e-df2ede4a55b2", "ordinal": 3, "variant_order": ["minimal_one_shot", "full_pipeline", "writer_only"]}, {"assignment_id": "1b99e61d-7dc9-5474-8b36-01cceb4986a9", "reviewer_code": "TEST-C", "case_id": "2e6a95df-a2d4-57bc-822e-df2ede4a55b2", "ordinal": 3, "variant_order": ["minimal_one_shot", "full_pipeline", "writer_only"]}]}$seed_29210006dd1a$::jsonb;
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

-- A successful run returns ready / 3 / 2 / 6.
select 'ready' as setup_status,
 (select count(*) from review_private.cases where is_test and study_version='interface-test-v3') as test_cases,
 (select count(*) from review_private.reviewers where reviewer_code in ('TEST-A','TEST-C')) as test_reviewer_slots,
 (select count(*) from review_private.assignments where reviewer_code in ('TEST-A','TEST-C')) as test_assignments;
