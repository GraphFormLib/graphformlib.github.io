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
