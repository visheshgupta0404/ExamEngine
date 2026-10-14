-- Apply once in the Supabase SQL editor. All application data is private.
-- Only the authenticated RPC is exposed; no client can read an answer-key table.
begin;
create schema if not exists exam_private;
revoke all on schema exam_private from public, anon, authenticated;

create table exam_private.colleges (
  id text primary key default gen_random_uuid()::text,
  name text not null check (length(name) between 1 and 100),
  domains text[] not null check (cardinality(domains) between 1 and 10),
  enabled boolean not null default true
);
create table exam_private.admin_emails (email text primary key check (email = lower(email)));
create table exam_private.professor_access (
  id text primary key default gen_random_uuid()::text,
  email text unique not null check (email = lower(email)),
  name text not null,
  college_id text not null references exam_private.colleges(id),
  approved boolean not null default false
);
create table exam_private.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  name text not null default '',
  role text not null default 'student' check (role in ('student','professor','admin')),
  college_id text references exam_private.colleges(id),
  roll text not null default '',
  class_name text not null default ''
);
create unique index student_roll_per_college on exam_private.profiles(college_id,lower(roll)) where roll <> '' and role = 'student';
create table exam_private.quizzes (
  id text primary key,
  owner_id uuid not null references exam_private.profiles(id),
  college_id text not null references exam_private.colleges(id),
  code text not null,
  published boolean not null default false,
  release boolean not null default false,
  draft jsonb not null,
  current_version text,
  unique(college_id,code)
);
create table exam_private.versions (
  id text primary key default gen_random_uuid()::text,
  quiz_id text not null references exam_private.quizzes(id),
  public_quiz jsonb not null,
  answer_key jsonb not null,
  created_at timestamptz not null default now()
);
alter table exam_private.quizzes add foreign key (current_version) references exam_private.versions(id);
create table exam_private.rosters (
  quiz_id text not null references exam_private.quizzes(id) on delete cascade,
  email text not null,
  roll text not null default '',
  primary key (quiz_id,email)
);
create table exam_private.attempts (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references exam_private.profiles(id),
  quiz_id text not null references exam_private.quizzes(id),
  version_id text not null references exam_private.versions(id),
  identity jsonb not null,
  public_quiz jsonb not null,
  answers jsonb not null default '{}',
  flagged jsonb not null default '[]',
  current_question integer not null default 0,
  revision integer not null default 0,
  started_at timestamptz not null default now(),
  deadline timestamptz not null,
  question_deadline timestamptz,
  status text not null default 'active' check (status in ('active','submitted')),
  submitted_at timestamptz,
  reason text,
  manual_grades jsonb not null default '{}',
  result jsonb
);
create unique index one_active_attempt on exam_private.attempts(user_id,quiz_id) where status='active';
create index attempt_history on exam_private.attempts(user_id,started_at desc);
create index quiz_submissions on exam_private.attempts(quiz_id,status);
create table exam_private.audit (
  id bigint generated always as identity primary key,
  actor uuid references auth.users(id),
  operation text not null,
  record_id text,
  created_at timestamptz not null default now()
);
create table exam_private.throttle (
  user_id uuid not null,
  operation text not null,
  minute timestamptz not null,
  count integer not null default 1,
  primary key(user_id,operation,minute)
);
-- Defense in depth: no table access even if a schema grant is changed later.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='exam_private' loop
    execute format('alter table exam_private.%I enable row level security',t.tablename);
    execute format('revoke all on exam_private.%I from public, anon, authenticated',t.tablename);
  end loop;
end $$;

create function exam_private.actor() returns exam_private.profiles
language plpgsql security definer set search_path = '' as $$
declare u auth.users; p exam_private.profiles; access exam_private.professor_access; cid text;
begin
  select * into u from auth.users where id=auth.uid();
  if u.id is null or u.email_confirmed_at is null or not (coalesce(u.raw_app_meta_data->'providers','[]'::jsonb) ? 'google') then
    raise exception 'Sign in with a verified Google account.' using errcode='42501';
  end if;
  select * into p from exam_private.profiles where id=u.id;
  select * into access from exam_private.professor_access where email=lower(u.email);
  if exists(select 1 from exam_private.admin_emails where email=lower(u.email)) then
    insert into exam_private.profiles(id,email,name,role) values(u.id,lower(u.email),coalesce(u.raw_user_meta_data->>'full_name','Administrator'),'admin')
      on conflict(id) do update set role='admin',email=excluded.email returning * into p;
  elsif access.id is not null then
    if not access.approved then raise exception 'Professor approval is pending.' using errcode='42501'; end if;
    if not exists(select 1 from exam_private.colleges where id=access.college_id and enabled) then raise exception 'College access is disabled.' using errcode='42501'; end if;
    insert into exam_private.profiles(id,email,name,role,college_id) values(u.id,lower(u.email),access.name,'professor',access.college_id)
      on conflict(id) do update set role='professor',college_id=excluded.college_id,email=excluded.email returning * into p;
  else
    select id into cid from exam_private.colleges where enabled and lower(split_part(u.email,'@',2))=any(domains) order by id limit 1;
    if cid is null then raise exception 'Your verified email domain is not registered to an enabled college.' using errcode='42501'; end if;
    insert into exam_private.profiles(id,email,name,role,college_id) values(u.id,lower(u.email),coalesce(u.raw_user_meta_data->>'full_name',''),'student',cid)
      on conflict(id) do update set email=excluded.email,role='student',college_id=excluded.college_id returning * into p;
  end if;
  return p;
end $$;

create function exam_private.validate_quiz(q jsonb) returns void
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
    or coalesce((q->>'perQuestionSeconds')::numeric,0) not between 0 and 3600 then raise exception 'Invalid quiz rules.'; end if;
  if q->>'opensAt' is not null and q->>'closesAt' is not null and (q->>'opensAt')::timestamptz >= (q->>'closesAt')::timestamptz then raise exception 'Closing time must follow opening time.'; end if;
  if coalesce(q->>'joinMode','both') not in ('both','code','roster') then raise exception 'Invalid join mode.'; end if;
  if jsonb_typeof(q->'questions')<>'array' or jsonb_array_length(q->'questions') not between 1 and 100 then raise exception 'Add 1–100 questions.'; end if;
  for question in select value from jsonb_array_elements(q->'questions') loop
    if length(coalesce(question->>'id','')) not between 1 and 100 or (question->>'id')=any(seen) then raise exception 'Question IDs must be unique.'; end if;
    seen:=array_append(seen,question->>'id');
    if length(trim(coalesce(question->>'text',''))) not between 1 and 4000 then raise exception 'Question text is required (maximum 4000 characters).'; end if;
    if coalesce(question->>'image','')<>'' and (length(question->>'image')>2000 or (question->>'image') !~ '^https://') then raise exception 'Question images require an HTTPS URL.'; end if;
    typ:=coalesce(question->>'type','single');
    if typ not in ('single','multiple','written') then raise exception 'Unknown question type.'; end if;
    if typ<>'written' then
      if jsonb_typeof(question->'options')<>'array' or jsonb_array_length(question->'options') not between 2 and 6 then raise exception 'Add 2–6 answer options.'; end if;
      for opt in select value from jsonb_array_elements(question->'options') loop
        if jsonb_typeof(opt)<>'string' or length(trim(opt#>>'{}')) not between 1 and 1000 then raise exception 'Invalid answer option.'; end if;
      end loop;
      if typ='single' then
        if coalesce(question->>'correctOption','') !~ '^[0-5]$' or (question->>'correctOption')::int>=jsonb_array_length(question->'options') then raise exception 'Select a correct answer.'; end if;
      else
        answers:=question->'correctOptions';
        if jsonb_typeof(answers)<>'array' or jsonb_array_length(answers)<1 or jsonb_array_length(answers)>(select count(distinct value) from jsonb_array_elements(answers)) then raise exception 'Select distinct correct answers.'; end if;
        for opt in select value from jsonb_array_elements(answers) loop
          if (opt#>>'{}') !~ '^[0-5]$' or (opt#>>'{}')::int>=jsonb_array_length(question->'options') then raise exception 'Invalid correct option.'; end if;
        end loop;
      end if;
    end if;
  end loop;
end $$;

create function exam_private.public_quiz(q jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select q - 'questions' - 'roster' || jsonb_build_object('questions', coalesce((select jsonb_agg(value - 'correctOption' - 'correctOptions' - 'rubric') from jsonb_array_elements(q->'questions')),'[]'::jsonb))
$$;

create function exam_private.grade(aid text) returns void
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
    if response is null or response='null'::jsonb or response='[]'::jsonb or response='""'::jsonb then blank:=blank+1;
    elsif typ='written' then
      if a.manual_grades ? (question->>'id') then score:=score+(a.manual_grades->(question->>'id')->>'marks')::numeric; else pending:=pending+1; end if;
    elsif typ='single' and response=(expected->'correctOption') or typ='multiple' and response @> (expected->'correctOptions') and response <@ (expected->'correctOptions') then c:=c+1; score:=score+marks;
    else wrong:=wrong+1; score:=score-penalty; end if;
  end loop;
  update exam_private.attempts set result=jsonb_build_object('correct',c,'incorrect',wrong,'unanswered',blank,'maximum',maximum,'score',score,'percent',round(score/maximum*100),'pendingManual',pending) where id=aid;
end $$;

create function exam_private.finish(aid text, why text) returns void
language plpgsql set search_path = '' as $$
begin
  perform 1 from exam_private.attempts where id=aid for update;
  update exam_private.attempts set status='submitted',submitted_at=now(),reason=why where id=aid and status='active';
  if found then perform exam_private.grade(aid); end if;
end $$;

create function exam_private.attempt_json(a exam_private.attempts, privileged boolean) returns jsonb
language plpgsql stable set search_path = '' as $$
declare released boolean; q jsonb; review jsonb;
begin
  select release into released from exam_private.quizzes where id=a.quiz_id;
  q:=a.public_quiz;
  if a.status='submitted' and (privileged or released and coalesce((a.result->>'pendingManual')::int,0)=0) then
    select jsonb_agg(value || coalesce(v.answer_key->(value->>'id'),'{}')) into review from jsonb_array_elements(q->'questions'),exam_private.versions v where v.id=a.version_id;
    q:=jsonb_set(q,'{questions}',review);
  end if;
  return jsonb_build_object('id',a.id,'quizId',a.quiz_id,'quiz',q,'identity',a.identity,
    'startedAt',extract(epoch from a.started_at)*1000,'deadline',extract(epoch from a.deadline)*1000,
    'questionDeadline',extract(epoch from a.question_deadline)*1000,'answers',a.answers,'flagged',a.flagged,'current',a.current_question,'revision',a.revision,
    'status',a.status,'reason',a.reason,'submittedAt',extract(epoch from a.submitted_at)*1000,
    'manualGrades',case when privileged or released and coalesce((a.result->>'pendingManual')::int,0)=0 then a.manual_grades else '{}'::jsonb end,
    'result',case when privileged or released and coalesce((a.result->>'pendingManual')::int,0)=0 then a.result else null end,
    'pendingGrading',coalesce((a.result->>'pendingManual')::int,0)>0);
end $$;

create function exam_private.expired(a exam_private.attempts) returns boolean
language sql stable set search_path='' as $$
  select a.deadline<=now() or a.question_deadline is not null and a.question_deadline+make_interval(secs=>coalesce((a.public_quiz->>'perQuestionSeconds')::int,0)*(jsonb_array_length(a.public_quiz->'questions')-a.current_question-1))<=now()
$$;
create function exam_private.workspace(p exam_private.profiles) returns jsonb
language plpgsql set search_path = '' as $$
declare quizzes jsonb; attempts jsonb; colleges jsonb; professors jsonb; is_admin boolean:=p.role='admin';
begin
  -- Finalize expired attempts on any access, including after a disconnected client returns.
  perform exam_private.finish(a.id,'timeout') from exam_private.attempts a where status='active' and exam_private.expired(a) and (a.user_id=p.id or p.role in ('professor','admin') and exists(select 1 from exam_private.quizzes q where q.id=a.quiz_id and (is_admin or q.owner_id=p.id)));
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'domains',domains,'enabled',enabled) order by name),'[]') into colleges from exam_private.colleges where is_admin or enabled;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'collegeId',college_id,'status',case when approved then 'approved' else 'pending' end)),'[]') into professors from exam_private.professor_access where is_admin or email=p.email;
  select coalesce(jsonb_agg(case when p.role in ('professor','admin') then q.draft || jsonb_build_object('published',q.published,'release',q.release,'professorId',q.owner_id,'roster',coalesce((select jsonb_agg(jsonb_build_object('email',r.email,'roll',r.roll)) from exam_private.rosters r where r.quiz_id=q.id),'[]'::jsonb))
    else v.public_quiz || jsonb_build_object('published',q.published,'release',q.release) end order by q.draft->>'title'),'[]') into quizzes
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

create function exam_private.execute(operation text, payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p exam_private.profiles; q exam_private.quizzes; v exam_private.versions; a exam_private.attempts;
  document jsonb; question jsonb; response jsonb; questions jsonb; key jsonb; aid text; email text; domain text; cid text;
  counter int; idx int; save_revision int; allowed_domains text[]; question_time int; endtime timestamptz; eligible boolean; row_entry jsonb;
begin
  p:=exam_private.actor();
  if octet_length(payload::text)>2000000 then raise exception 'Request is too large.'; end if;
  if operation='workspace' then return exam_private.workspace(p); end if;
  if operation='backup' then
    if p.role<>'admin' then raise exception 'Administrator access required.' using errcode='42501'; end if;
    insert into exam_private.audit(actor,operation) values(p.id,'backup');
    return jsonb_build_object('format',1,'createdAt',now(),
      'colleges',coalesce((select jsonb_agg(to_jsonb(t)) from exam_private.colleges t),'[]'),
      'admin_emails',coalesce((select jsonb_agg(to_jsonb(t)) from exam_private.admin_emails t),'[]'),
      'professor_access',coalesce((select jsonb_agg(to_jsonb(t)) from exam_private.professor_access t),'[]'),
      'profiles',coalesce((select jsonb_agg(to_jsonb(t)) from exam_private.profiles t),'[]'),
      'quizzes',coalesce((select jsonb_agg(to_jsonb(t)) from exam_private.quizzes t),'[]'),
      'versions',coalesce((select jsonb_agg(to_jsonb(t)) from exam_private.versions t),'[]'),
      'rosters',coalesce((select jsonb_agg(to_jsonb(t)) from exam_private.rosters t),'[]'),
      'attempts',coalesce((select jsonb_agg(to_jsonb(t)) from exam_private.attempts t),'[]'));
  end if;

  if operation='profile' then
    if p.role<>'student' then raise exception 'Only students update these details.' using errcode='42501'; end if;
    if exists(select 1 from exam_private.attempts where user_id=p.id and status='active' and deadline>now()) then raise exception 'Finish your active assessment before changing details.'; end if;
    if length(trim(coalesce(payload->>'name',''))) not between 1 and 100 or length(trim(coalesce(payload->>'roll',''))) not between 1 and 50 or length(trim(coalesce(payload->>'className',''))) not between 1 and 100 then raise exception 'Complete your name, roll number, and class.'; end if;
    update exam_private.profiles set name=trim(payload->>'name'),roll=trim(payload->>'roll'),class_name=trim(payload->>'className') where id=p.id returning * into p;
  elsif operation='join' then
    select * into q from exam_private.quizzes where code=upper(trim(payload->>'code')) and college_id=p.college_id and published;
    if p.role<>'student' or q.id is null or coalesce(q.draft->>'joinMode','both')='roster' then raise exception 'No eligible quiz matches that code.' using errcode='42501'; end if;
    if lower(q.draft->>'className')<>lower(p.class_name) then raise exception 'This quiz is assigned to another class.' using errcode='42501'; end if;
    select * into v from exam_private.versions where id=q.current_version;
    return v.public_quiz || jsonb_build_object('published',q.published,'release',q.release);
  elsif operation='start' then
    if p.role<>'student' or p.roll='' or p.class_name='' or p.name='' then raise exception 'Complete your student details before starting.'; end if;
    -- Serialize starts per student; enforces one active assessment and attempt limits on concurrent requests.
    perform 1 from exam_private.profiles where id=p.id for update;
    select * into q from exam_private.quizzes where id=payload->>'quizId' and college_id=p.college_id and published for share;
    if q.id is null or lower(q.draft->>'className')<>lower(p.class_name) then raise exception 'Assessment access denied.' using errcode='42501'; end if;
    select * into v from exam_private.versions where id=q.current_version;
    eligible:=coalesce(v.public_quiz->>'joinMode','both')<>'roster' or exists(select 1 from exam_private.rosters r where r.quiz_id=q.id and r.email=p.email and (r.roll='' or lower(r.roll)=lower(p.roll)));
    if not eligible or coalesce(v.public_quiz->>'joinMode','both')='code' and upper(trim(coalesce(payload->>'code','')))<>q.code then raise exception 'Roster or quiz-code eligibility is required.' using errcode='42501'; end if;
    if v.public_quiz->>'opensAt' is not null and now()<(v.public_quiz->>'opensAt')::timestamptz then raise exception 'This assessment has not opened yet.'; end if;
    if v.public_quiz->>'closesAt' is not null and now()>=(v.public_quiz->>'closesAt')::timestamptz then raise exception 'This assessment is closed.'; end if;
    perform exam_private.finish(expired_attempt.id,'timeout') from exam_private.attempts expired_attempt where user_id=p.id and status='active' and exam_private.expired(expired_attempt);
    select * into a from exam_private.attempts where user_id=p.id and status='active';
    if a.id is not null then
      if a.quiz_id<>q.id then raise exception 'Finish your other active assessment first.'; end if;
      return exam_private.workspace(p);
    end if;
    if (select count(*) from exam_private.attempts where user_id=p.id and quiz_id=q.id)>=(v.public_quiz->>'attemptLimit')::int then raise exception 'No attempts remaining.'; end if;
    document:=v.public_quiz;
    if coalesce((document->>'shuffle')::boolean,false) then select jsonb_agg(value order by random()) into questions from jsonb_array_elements(document->'questions'); document:=jsonb_set(document,'{questions}',questions); end if;
    endtime:=now()+make_interval(mins=>(document->>'duration')::int);
    if document->>'closesAt' is not null then endtime:=least(endtime,(document->>'closesAt')::timestamptz); end if;
    question_time:=coalesce((document->>'perQuestionSeconds')::int,0);
    insert into exam_private.attempts(user_id,quiz_id,version_id,identity,public_quiz,deadline,question_deadline)
      values(p.id,q.id,v.id,jsonb_build_object('name',p.name,'roll',p.roll,'email',p.email,'collegeId',p.college_id,'className',p.class_name),document,endtime,
        case when question_time>0 then least(endtime,now()+make_interval(secs=>question_time)) end);
  elsif operation in ('save','advance','submit') then
    select * into a from exam_private.attempts where id=payload->>'attemptId' and user_id=p.id for update;
    if a.id is null or p.role<>'student' then raise exception 'Attempt access denied.' using errcode='42501'; end if;
    if a.status='submitted' then return case when operation='submit' then exam_private.workspace(p) else exam_private.attempt_json(a,false) end; end if;
    if exam_private.expired(a) then perform exam_private.finish(a.id,'timeout'); return exam_private.workspace(p); end if;
    question_time:=coalesce((a.public_quiz->>'perQuestionSeconds')::int,0);
    if operation='submit' then perform exam_private.finish(a.id,case when a.question_deadline<=now() and a.current_question=jsonb_array_length(a.public_quiz->'questions')-1 then 'timeout' else 'student' end); return exam_private.workspace(p); end if;
    if operation='advance' then
      if payload->>'current' is not null and (payload->>'current')::int<>a.current_question then return exam_private.attempt_json(a,false); end if;
      if a.current_question>=jsonb_array_length(a.public_quiz->'questions')-1 then perform exam_private.finish(a.id,case when a.question_deadline<=now() then 'timeout' else 'student' end); return exam_private.workspace(p); end if;
      idx:=case when question_time>0 and a.question_deadline<=now() then floor(extract(epoch from (now()-a.question_deadline))/question_time)::int+1 else 1 end;
      if a.current_question+idx>=jsonb_array_length(a.public_quiz->'questions') then perform exam_private.finish(a.id,'timeout'); return exam_private.workspace(p); end if;
      update exam_private.attempts set current_question=current_question+idx,question_deadline=case when question_time>0 then least(deadline,case when a.question_deadline<=now() then a.question_deadline+make_interval(secs=>idx*question_time) else now()+make_interval(secs=>question_time) end) end,revision=revision+1 where id=a.id;
    else
      if question_time>0 and a.question_deadline<=now() then raise exception 'This question has expired. Continue to the next question.'; end if;
      save_revision:=coalesce((payload->>'revision')::int,0);
      if save_revision<=a.revision then return exam_private.attempt_json(a,false); end if;
      document:=coalesce(payload->'answers','{}');
      if jsonb_typeof(document)<>'object' then raise exception 'Invalid responses.'; end if;
      if exists(select 1 from jsonb_object_keys(document) k where not exists(select 1 from jsonb_array_elements(a.public_quiz->'questions') candidate where candidate->>'id'=k)) then raise exception 'Unknown question ID.'; end if;
      for question in select value from jsonb_array_elements(a.public_quiz->'questions') loop
        response:=document->(question->>'id');
        if response is not null and response<>'null'::jsonb then
          if coalesce(question->>'type','single')='written' then
            if jsonb_typeof(response)<>'string' or length(response#>>'{}')>10000 then raise exception 'Written answers are limited to 10000 characters.'; end if;
          elsif coalesce(question->>'type','single')='single' then
            if jsonb_typeof(response)<>'number' or (response#>>'{}') !~ '^[0-5]$' or (response#>>'{}')::int>=jsonb_array_length(question->'options') then raise exception 'Invalid selected answer.'; end if;
          else
            if jsonb_typeof(response)<>'array' or jsonb_array_length(response)>(select count(distinct value) from jsonb_array_elements(response)) then raise exception 'Select distinct answers.'; end if;
            if exists(select 1 from jsonb_array_elements(response) x where jsonb_typeof(x)<>'number' or (x#>>'{}') !~ '^[0-5]$' or (x#>>'{}')::int>=jsonb_array_length(question->'options')) then raise exception 'Invalid selected answers.'; end if;
          end if;
        end if;
        -- Previous timed questions are immutable, including clears/deletions.
        if (question_time>0 or not coalesce((a.public_quiz->>'allowNavigation')::boolean,true)) and question->>'id'<>(a.public_quiz->'questions'->a.current_question->>'id') and response is distinct from a.answers->(question->>'id') then raise exception 'Previous or future forward-only responses cannot be changed.'; end if;
      end loop;
      idx:=coalesce((payload->>'current')::int,a.current_question);
      if idx<0 or idx>=jsonb_array_length(a.public_quiz->'questions') or (question_time>0 or not coalesce((a.public_quiz->>'allowNavigation')::boolean,true)) and idx<>a.current_question then raise exception 'Use the next-question operation for this assessment.'; end if;
      if jsonb_typeof(coalesce(payload->'flagged','[]'))<>'array' or exists(select 1 from jsonb_array_elements_text(coalesce(payload->'flagged','[]')) f where not exists(select 1 from jsonb_array_elements(a.public_quiz->'questions') qq where qq->>'id'=f)) then raise exception 'Invalid review flags.'; end if;
      update exam_private.attempts set answers=document,flagged=coalesce(payload->'flagged','[]'),current_question=idx,revision=save_revision where id=a.id;
    end if;
    select * into a from exam_private.attempts where id=a.id;
    return exam_private.attempt_json(a,false);
  elsif operation in ('saveQuiz','publish','roster','manualGrade') then
    if p.role<>'professor' then raise exception 'Approved professor access required.' using errcode='42501'; end if;
    if operation='saveQuiz' then
      document:=(payload->'quiz') - 'roster'; perform exam_private.validate_quiz(document);
      for question in select value from jsonb_array_elements(document->'questions') loop
        if coalesce(question->>'imagePath','')<>'' and (length(question->>'imagePath')>200 or split_part(question->>'imagePath','/',1)<>p.id::text) then raise exception 'Image ownership mismatch.' using errcode='42501'; end if;
      end loop;
      select jsonb_agg(case when value ? 'imagePath' then value || '{"image":""}'::jsonb else value end) into questions from jsonb_array_elements(document->'questions');
      document:=jsonb_set(document,'{questions}',questions);
      select * into q from exam_private.quizzes where id=document->>'id' for update;
      if q.id is not null and q.owner_id<>p.id then raise exception 'Quiz access denied.' using errcode='42501'; end if;
      document:=document || jsonb_build_object('collegeId',p.college_id,'professorId',p.id,'published',coalesce(q.published,false));
      insert into exam_private.quizzes(id,owner_id,college_id,code,draft,release) values(document->>'id',p.id,p.college_id,document->>'code',document,coalesce((document->>'release')::boolean,false))
        on conflict(id) do update set code=excluded.code,draft=excluded.draft,release=excluded.release returning * into q;
      if q.published then
        select jsonb_object_agg(value->>'id',jsonb_build_object('correctOption',value->'correctOption','correctOptions',value->'correctOptions','rubric',value->'rubric')) into key from jsonb_array_elements(document->'questions');
        insert into exam_private.versions(quiz_id,public_quiz,answer_key) values(q.id,exam_private.public_quiz(document),key) returning * into v;
        update exam_private.quizzes set current_version=v.id where id=q.id;
      end if;
    else
      select * into q from exam_private.quizzes where id=payload->>'quizId' and owner_id=p.id and college_id=p.college_id for update;
      if q.id is null then raise exception 'Quiz access denied.' using errcode='42501'; end if;
      if operation='publish' then
        if coalesce((payload->>'published')::boolean,false) then
          perform exam_private.validate_quiz(q.draft);
          if coalesce(q.draft->>'joinMode','both')='roster' and not exists(select 1 from exam_private.rosters where quiz_id=q.id) then raise exception 'Add a roster before publishing a roster-only assessment.'; end if;
          select jsonb_object_agg(value->>'id',jsonb_build_object('correctOption',value->'correctOption','correctOptions',value->'correctOptions','rubric',value->'rubric')) into key from jsonb_array_elements(q.draft->'questions');
          insert into exam_private.versions(quiz_id,public_quiz,answer_key) values(q.id,exam_private.public_quiz(q.draft),key) returning * into v;
          update exam_private.quizzes set published=true,current_version=v.id where id=q.id;
        else update exam_private.quizzes set published=false where id=q.id; end if;
      elsif operation='roster' then
        if jsonb_typeof(payload->'rows')<>'array' or jsonb_array_length(payload->'rows')>2000 then raise exception 'Import at most 2000 roster entries.'; end if;
        for row_entry in select value from jsonb_array_elements(payload->'rows') loop
          email:=lower(trim(row_entry->>'email'));
          if email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or not exists(select 1 from exam_private.colleges where id=q.college_id and split_part(email,'@',2)=any(domains)) or length(coalesce(row_entry->>'roll',''))>50 then raise exception 'Roster entries must use the college email domain and valid roll numbers.'; end if;
        end loop;
        delete from exam_private.rosters where quiz_id=q.id;
        insert into exam_private.rosters(quiz_id,email,roll) select q.id,lower(trim(value->>'email')),trim(coalesce(value->>'roll','')) from jsonb_array_elements(payload->'rows');
      else
        select * into a from exam_private.attempts where id=payload->>'attemptId' and quiz_id=q.id and status='submitted' for update;
        if a.id is null then raise exception 'Submission not found.'; end if;
        for question in select value from jsonb_array_elements(a.public_quiz->'questions') loop
          if question->>'type'='written' and payload->'grades' ? (question->>'id') then
            response:=payload->'grades'->(question->>'id');
            if coalesce((response->>'marks')::numeric,-1) not between 0 and (a.public_quiz->>'marks')::numeric or length(coalesce(response->>'feedback',''))>2000 then raise exception 'Invalid manual grade.'; end if;
            a.manual_grades:=a.manual_grades || jsonb_build_object(question->>'id',response);
          end if;
        end loop;
        update exam_private.attempts set manual_grades=a.manual_grades where id=a.id; perform exam_private.grade(a.id);
      end if;
    end if;
  elsif operation in ('college','professor','approve') then
    if p.role<>'admin' then raise exception 'Administrator access required.' using errcode='42501'; end if;
    if operation='college' then
      if length(trim(coalesce(payload->>'name',''))) not between 1 and 100 or jsonb_typeof(payload->'domains')<>'array' then raise exception 'College name and domains are required.'; end if;
      select array_agg(distinct lower(trim(value))) into allowed_domains from jsonb_array_elements_text(payload->'domains');
      if coalesce(cardinality(allowed_domains),0) not between 1 and 10 or exists(select 1 from unnest(allowed_domains) d where d !~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$') then raise exception 'Invalid email domain.'; end if;
      cid:=coalesce(payload->>'id',gen_random_uuid()::text);
      if exists(select 1 from exam_private.colleges where id<>cid and allowed_domains && exam_private.colleges.domains) then raise exception 'That domain belongs to another college.'; end if;
      insert into exam_private.colleges(id,name,domains,enabled) values(cid,trim(payload->>'name'),allowed_domains,coalesce((payload->>'enabled')::boolean,true))
        on conflict(id) do update set name=excluded.name,domains=excluded.domains,enabled=excluded.enabled;
    elsif operation='professor' then
      email:=lower(trim(payload->>'email'));
      if email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(trim(coalesce(payload->>'name',''))) not between 1 and 100 then raise exception 'Valid professor name and email required.'; end if;
      insert into exam_private.professor_access(email,name,college_id) values(email,trim(payload->>'name'),payload->>'collegeId');
    else update exam_private.professor_access set approved=(payload->>'approved')::boolean where id=payload->>'id'; if not found then raise exception 'Professor not found.'; end if;
    end if;
  else raise exception 'Unknown operation.'; end if;
  insert into exam_private.audit(actor,operation,record_id) values(p.id,operation,coalesce(q.id,payload->>'id'));
  return exam_private.workspace(p);
end $$;
create function public.examengine(operation text, payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p exam_private.profiles; counter int;
begin
  p:=exam_private.actor();
  insert into exam_private.throttle(user_id,operation,minute) values(p.id,operation,date_trunc('minute',now()))
    on conflict on constraint throttle_pkey do update set count=exam_private.throttle.count+1 returning count into counter;
  if counter>(case when operation='save' then 180 else 60 end) then return jsonb_build_object('error','Too many requests. Wait a minute and retry.','code','RATE_LIMIT'); end if;
  delete from exam_private.throttle where minute<now()-interval '10 minutes';
  -- The subtransaction rolls back failed mutations, while retaining the rate-limit increment.
  begin
    return exam_private.execute(operation,payload);
  exception when others then
    return jsonb_build_object('error',case when sqlstate='23505' then 'This record, roll number, or code already exists.' when sqlstate='23503' then 'A referenced record was not found.' when sqlstate in ('22P02','22007','22008') then 'Invalid field value.' else sqlerrm end,'code',sqlstate);
  end;
end $$;
-- Explicitly close PostgreSQL's default PUBLIC function-execution grants.
revoke all on all functions in schema exam_private from public,anon,authenticated;
revoke all on function public.examengine(text,jsonb) from public,anon;
grant execute on function public.examengine(text,jsonb) to authenticated;
commit;
