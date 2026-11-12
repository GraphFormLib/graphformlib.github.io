-- Human comparative review v2: one overall naturalness choice, ties, optional comments.
-- Apply before collecting comparative responses. Existing observations are never relabelled.
begin;
do $guard$ begin
  if exists(select 1 from review_private.responses s join review_private.assignments a using(assignment_id)
    join review_private.reviewers r using(reviewer_code) where r.review_mode='comparative') then
    raise exception 'Comparative responses already exist. Preserve their protocol before changing the rubric.';
  end if;
end $guard$;
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
notify pgrst,'reload schema';
commit;
