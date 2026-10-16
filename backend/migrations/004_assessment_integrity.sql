-- Upgrade an existing installation once, after 003. No records are deleted.
-- Hide question content until an authorized attempt starts; tighten validation and blank-answer grading.
begin;

create or replace function exam_private.quiz_summary(q jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select q - 'questions' - 'roster' || jsonb_build_object(
    'questions','[]'::jsonb,
    'questionCount',jsonb_array_length(q->'questions'),
    'hasWritten',exists(select 1 from jsonb_array_elements(q->'questions') item where item->>'type'='written'))
$$;
revoke all on function exam_private.quiz_summary(jsonb) from public,anon,authenticated;

create or replace function exam_private.workspace(p exam_private.profiles) returns jsonb
language plpgsql set search_path = '' as $$
declare quizzes jsonb; attempts jsonb; colleges jsonb; professors jsonb; is_admin boolean:=p.role='admin';
begin
  -- Finalize expired attempts on any access, including after a disconnected client returns.
  perform exam_private.finish(a.id,'timeout') from exam_private.attempts a where status='active' and exam_private.expired(a) and (a.user_id=p.id or p.role in ('professor','admin') and exists(select 1 from exam_private.quizzes q where q.id=a.quiz_id and (is_admin or q.owner_id=p.id)));
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'domains',domains,'enabled',enabled) order by name),'[]') into colleges from exam_private.colleges where is_admin or enabled;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'collegeId',college_id,'status',case when approved then 'approved' else 'pending' end)),'[]') into professors from exam_private.professor_access where is_admin or email=p.email;
  select coalesce(jsonb_agg(case when p.role in ('professor','admin') then q.draft || jsonb_build_object('published',q.published,'release',q.release,'professorId',q.owner_id,'roster',coalesce((select jsonb_agg(jsonb_build_object('email',r.email,'roll',r.roll)) from exam_private.rosters r where r.quiz_id=q.id),'[]'::jsonb))
    else exam_private.quiz_summary(v.public_quiz) || jsonb_build_object('published',q.published,'release',q.release) end order by q.draft->>'title'),'[]') into quizzes
    from exam_private.quizzes q left join exam_private.versions v on v.id=q.current_version
    where is_admin or p.role='professor' and q.owner_id=p.id or p.role='student' and q.college_id=p.college_id and (
      q.published and (coalesce(q.draft->>'joinMode','both')<>'code' and lower(q.draft->>'className')=lower(p.class_name)
        and (coalesce(q.draft->>'joinMode','both')<>'roster' or exists(select 1 from exam_private.rosters r where r.quiz_id=q.id and r.email=p.email)))
      or exists(select 1 from exam_private.attempts a where a.quiz_id=q.id and a.user_id=p.id));
  select coalesce(jsonb_agg(exam_private.attempt_json(a,p.role<>'student') order by started_at desc),'[]') into attempts
    from exam_private.attempts a join exam_private.quizzes q on q.id=a.quiz_id where is_admin or p.role='professor' and q.owner_id=p.id or a.user_id=p.id;
  return jsonb_build_object('version',2,'role',p.role,'actorId',p.id,'colleges',colleges,'professors',professors,'quizzes',quizzes,'attempts',attempts,
    'identity',jsonb_build_object('name',p.name,'email',p.email,'roll',p.roll,'collegeId',coalesce(p.college_id,(select id from exam_private.colleges order by id limit 1)),'className',p.class_name),
    'audit',case when is_admin then coalesce((select jsonb_agg(jsonb_build_object('operation',operation,'recordId',record_id,'createdAt',created_at)) from (select * from exam_private.audit order by created_at desc limit 50) recent),'[]'::jsonb) else '[]'::jsonb end,
    'serverNow',extract(epoch from now())*1000);
end $$;

create or replace function exam_private.grade(aid text) returns void
language plpgsql set search_path = '' as $$
declare a exam_private.attempts; key jsonb; question jsonb; response jsonb; expected jsonb;
  c int:=0; wrong int:=0; blank int:=0; pending int:=0; score numeric:=0; maximum numeric; marks numeric; penalty numeric; typ text;
begin
  select * into a from exam_private.attempts where id=aid for update;
  select answer_key into key from exam_private.versions where id=a.version_id;
  marks:=(a.public_quiz->>'marks')::numeric; penalty:=(a.public_quiz->>'penalty')::numeric;
  maximum:=jsonb_array_length(a.public_quiz->'questions')*marks;
  for question in select value from jsonb_array_elements(a.public_quiz->'questions') loop
    response:=a.answers->(question->>'id'); typ:=coalesce(question->>'type','single'); expected:=key->(question->>'id');
    if response is null or response='null'::jsonb or response='[]'::jsonb or response='""'::jsonb or typ='written' and (response#>>'{}') ~ '^[[:space:]]*$' then blank:=blank+1;
    elsif typ='written' then
      if a.manual_grades ? (question->>'id') then score:=score+(a.manual_grades->(question->>'id')->>'marks')::numeric; else pending:=pending+1; end if;
    elsif typ='single' and response=(expected->'correctOption') or typ='multiple' and response @> (expected->'correctOptions') and response <@ (expected->'correctOptions') then c:=c+1; score:=score+marks;
    else wrong:=wrong+1; score:=score-penalty; end if;
  end loop;
  update exam_private.attempts set result=jsonb_build_object('correct',c,'incorrect',wrong,'unanswered',blank,'maximum',maximum,'score',score,'percent',round(score/maximum*100),'pendingManual',pending) where id=aid;
end $$;

create or replace function exam_private.validate_quiz(q jsonb) returns void
language plpgsql set search_path = '' as $$
declare question jsonb; seen text[]:='{}'; typ text; opt jsonb; answers jsonb;
begin
  if length(trim(coalesce(q->>'title',''))) not between 1 and 140 or length(trim(coalesce(q->>'className',''))) not between 1 and 100
    or length(coalesce(q->>'description',''))>1000 or length(coalesce(q->>'subject',''))>100 then raise exception 'Invalid quiz details.'; end if;
  if coalesce(q->>'code','') !~ '^[A-Z0-9-]{4,20}$' then raise exception 'Invalid quiz code.'; end if;
  if coalesce((q->>'duration')::numeric,0) not between 1 and 240 or (q->>'duration')::numeric <> trunc((q->>'duration')::numeric)
    or coalesce((q->>'attemptLimit')::numeric,0) not between 1 and 10 or (q->>'attemptLimit')::numeric <> trunc((q->>'attemptLimit')::numeric)
    or coalesce((q->>'marks')::numeric,0) <= 0 or (q->>'marks')::numeric>100
    or coalesce((q->>'penalty')::numeric,-1)<0 or (q->>'penalty')::numeric>(q->>'marks')::numeric
    or coalesce((q->>'perQuestionSeconds')::numeric,0) not between 0 and 3600 or coalesce((q->>'perQuestionSeconds')::numeric,0)<>trunc(coalesce((q->>'perQuestionSeconds')::numeric,0)) then raise exception 'Invalid quiz rules.'; end if;
  if q->>'opensAt' is not null and q->>'closesAt' is not null and (q->>'opensAt')::timestamptz >= (q->>'closesAt')::timestamptz then raise exception 'Closing time must follow opening time.'; end if;
  if coalesce(q->>'joinMode','both') not in ('both','code','roster') then raise exception 'Invalid join mode.'; end if;
  if coalesce(jsonb_typeof(q->'questions'),'null')<>'array' or jsonb_array_length(q->'questions') not between 1 and 100 then raise exception 'Add 1–100 questions.'; end if;
  for question in select value from jsonb_array_elements(q->'questions') loop
    if length(coalesce(question->>'id','')) not between 1 and 100 or (question->>'id')=any(seen) then raise exception 'Question IDs must be unique.'; end if;
    seen:=array_append(seen,question->>'id');
    if length(trim(coalesce(question->>'text',''))) not between 1 and 4000 then raise exception 'Question text is required (maximum 4000 characters).'; end if;
    if coalesce(question->>'image','')<>'' and (length(question->>'image')>2000 or (question->>'image') !~ '^https://') then raise exception 'Question images require an HTTPS URL.'; end if;
    typ:=coalesce(question->>'type','single');
    if typ not in ('single','multiple','written') then raise exception 'Unknown question type.'; end if;
    if typ<>'written' then
      if coalesce(jsonb_typeof(question->'options'),'null')<>'array' or jsonb_array_length(question->'options') not between 2 and 6 then raise exception 'Add 2–6 answer options.'; end if;
      for opt in select value from jsonb_array_elements(question->'options') loop
        if jsonb_typeof(opt)<>'string' or length(trim(opt#>>'{}')) not between 1 and 1000 then raise exception 'Invalid answer option.'; end if;
      end loop;
      if typ='single' then
        if coalesce(question->>'correctOption','') !~ '^[0-5]$' or (question->>'correctOption')::int>=jsonb_array_length(question->'options') then raise exception 'Select a correct answer.'; end if;
      else
        answers:=question->'correctOptions';
        if coalesce(jsonb_typeof(answers),'null')<>'array' or jsonb_array_length(answers)<1 or jsonb_array_length(answers)>(select count(distinct value) from jsonb_array_elements(answers)) then raise exception 'Select distinct correct answers.'; end if;
        for opt in select value from jsonb_array_elements(answers) loop
          if (opt#>>'{}') !~ '^[0-5]$' or (opt#>>'{}')::int>=jsonb_array_length(question->'options') then raise exception 'Invalid correct option.'; end if;
        end loop;
      end if;
    end if;
  end loop;
end $$;

create or replace function public.examengine(operation text, payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p exam_private.profiles; counter int; result jsonb;
begin
  p:=exam_private.actor();
  insert into exam_private.throttle(user_id,operation,minute) values(p.id,operation,date_trunc('minute',now()))
    on conflict on constraint throttle_pkey do update set count=exam_private.throttle.count+1 returning count into counter;
  if counter>(case when operation='save' then 180 else 60 end) then return jsonb_build_object('error','Too many requests. Wait a minute and retry.','code','RATE_LIMIT'); end if;
  delete from exam_private.throttle where minute<now()-interval '10 minutes';
  -- The subtransaction rolls back failed mutations, while retaining the rate-limit increment.
  begin
    result:=exam_private.execute(operation,payload);
    return case when operation in ('join','quiz') then exam_private.quiz_summary(result) else result end;
  exception when others then
    return jsonb_build_object('error',case when sqlstate='23505' then 'This record, roll number, or code already exists.' when sqlstate='23503' then 'A referenced record was not found.' when sqlstate in ('22P02','22007','22008') then 'Invalid field value.' else sqlerrm end,'code',sqlstate);
  end;
end $$;

commit;
