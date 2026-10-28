-- Read-only database readiness probe. No application data or privileges are exposed.
begin;
create or replace function public.examengine_health() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('status','ok','version',1);
$$;
revoke all on function public.examengine_health() from public;
grant execute on function public.examengine_health() to anon,authenticated;
commit;
