-- Optional image upload support; apply after 001 in Supabase (storage schema is managed by Supabase).
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('question-images','question-images',false,5242880,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create function public.examengine_image_access(object_name text,writing boolean default false) returns boolean
language plpgsql security definer set search_path='' as $$
declare p exam_private.profiles;
begin
  p:=exam_private.actor();
  if writing then return p.role='professor' and split_part(object_name,'/',1)=p.id::text; end if;
  if p.role='admin' or p.role='professor' and split_part(object_name,'/',1)=p.id::text then return true; end if;
  return exists(select 1 from exam_private.attempts a join exam_private.quizzes q on q.id=a.quiz_id
    where a.user_id=p.id and (a.status='active' and a.deadline>now() or a.status='submitted' and q.release and coalesce((a.result->>'pendingManual')::int,0)=0)
    and exists(select 1 from jsonb_array_elements(a.public_quiz->'questions') question where question->>'imagePath'=object_name));
exception when others then return false;
end $$;
revoke all on function public.examengine_image_access(text,boolean) from public,anon;
grant execute on function public.examengine_image_access(text,boolean) to authenticated;
create policy examengine_images_insert on storage.objects for insert to authenticated
with check(bucket_id='question-images' and public.examengine_image_access(name,true));
create policy examengine_images_select on storage.objects for select to authenticated
using(bucket_id='question-images' and public.examengine_image_access(name,false));
-- Files have unique names and are immutable. No public upload/update/delete policies are granted.
commit;
