-- Safe maintenance function. No student records are deleted automatically.
begin;
create function exam_private.finalize_expired() returns integer
language plpgsql security definer set search_path='' as $$
declare item record; total integer:=0;
begin
  for item in select id from exam_private.attempts a where status='active' and exam_private.expired(a) order by deadline limit 500 for update skip locked loop
    perform exam_private.finish(item.id,'timeout');total:=total+1;
  end loop;
  delete from exam_private.throttle where minute<now()-interval '10 minutes';
  return total;
end $$;
revoke all on function exam_private.finalize_expired() from public,anon,authenticated;
commit;
-- If Supabase Cron is enabled, schedule this in its Cron UI every minute:
-- select exam_private.finalize_expired();
-- Expired attempts are also finalized on workspace access without Cron.
