-- م18-أ: الحذف النهائي (Hard Delete) للمستخدم مع كل بياناته — أدمن فقط
-- مُكيَّف على المخطط الفعلي: id bigint · جلسات · حذف صريح مُرتَّب (بلا تغيير قيود FK عالمياً).
-- ⚠️ لا رجعة فيه: يحذف المستخدم وتقييماته وسجلّاته وملفات PDF من التخزين.

-- 1) جدول أرشيف ملخّص المحذوفين (للسجل فقط — بلا بيانات التقييمات)
create table if not exists public.deleted_users_archive (
  id bigserial primary key,
  original_user_id bigint,
  full_name text, email text, role text, department text, department_id bigint,
  evaluations_count int, pdfs_count int,
  deleted_at timestamptz default now(),
  deleted_by bigint, deleted_by_name text, deletion_reason text
);

-- 2) معاينة ما سيُحذف (لعرضه في نافذة التأكيد) — أدمن فقط
create or replace function public.get_user_deletion_preview(p_session_token text, p_user_id bigint)
returns table(full_name text, role text, evaluations int, pdfs int, objections int,
              cg_weekly int, cg_actions int, cg_objections int, supervisees int)
language plpgsql security definer set search_path to 'public'
as $$
declare v_sess record; v_actor public.users; v_t public.users;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return; end if;
  select * into v_actor from public.users uu where uu.id = v_sess.user_id;
  if v_actor.role <> 'admin' then return; end if;
  select * into v_t from public.users where id = p_user_id;
  if v_t.id is null then return; end if;
  return query select
    v_t.full_name::text, v_t.role::text,
    (select count(*)::int from public.evaluations where employee_id = p_user_id),
    ((select count(*)::int from public.evaluations where employee_id = p_user_id and pdf_file_path is not null)
      + (select count(*)::int from public.creative_gene_weekly_status where employee_id = p_user_id and pdf_file_path is not null)),
    (select count(*)::int from public.objections where employee_id = p_user_id),
    (select count(*)::int from public.creative_gene_weekly_status where employee_id = p_user_id),
    (select count(*)::int from public.creative_gene_actions where employee_id = p_user_id),
    (select count(*)::int from public.creative_gene_objections where employee_id = p_user_id),
    (select count(*)::int from public.users where supervisor_id = p_user_id);
end; $$;

-- 3) الحذف النهائي الكامل — أدمن فقط
drop function if exists public.delete_user_completely(text, bigint, bigint, boolean, text);
create or replace function public.delete_user_completely(
  p_session_token text,
  p_user_id bigint,
  p_transfer_supervisees_to bigint default null,
  p_unlink_supervisees boolean default false,
  p_reason text default null
) returns table(ok boolean, code text, message text, evaluations_deleted int, pdfs_deleted int, pdf_paths text[])
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_sess record; v_actor public.users; v_target public.users;
  v_sup int; v_pdf text[]; v_eval_ct int; v_pdf_ct int; v_new_sup public.users;
begin
  -- المصادقة: أدمن فقط (خطورة عالية)
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,'session','انتهت الجلسة',0,0,'{}'::text[]; return; end if;
  select * into v_actor from public.users where id = v_sess.user_id;
  if v_actor.role <> 'admin' then return query select false,'forbidden','الحذف النهائي للمدير فقط',0,0,'{}'::text[]; return; end if;
  select * into v_target from public.users where id = p_user_id;
  if v_target.id is null then return query select false,'not_found','المستخدم غير موجود',0,0,'{}'::text[]; return; end if;
  if v_target.id = v_actor.id then return query select false,'self','لا يمكنك حذف حسابك الخاص',0,0,'{}'::text[]; return; end if;

  -- الموظفون التابعون (نقل / إزالة ربط / طلب قرار)
  select count(*) into v_sup from public.users where supervisor_id = v_target.id;
  if v_sup > 0 then
    if p_transfer_supervisees_to is not null then
      select * into v_new_sup from public.users where id = p_transfer_supervisees_to;
      if v_new_sup.id is null or v_new_sup.id = v_target.id then return query select false,'bad_transfer','المشرف البديل غير صالح',0,0,'{}'::text[]; return; end if;
      update public.users set supervisor_id = v_new_sup.id, supervisor_name = v_new_sup.full_name where supervisor_id = v_target.id;
    elsif p_unlink_supervisees then
      update public.users set supervisor_id = null, supervisor_name = null where supervisor_id = v_target.id;
    else
      return query select false,'require_transfer',('لدى هذا المشرف '||v_sup||' موظفاً — انقلهم لمشرف آخر أو أزِل الربط'),0,0,'{}'::text[]; return;
    end if;
  end if;

  -- جمع مسارات PDF قبل الحذف (evaluations + creative_gene_weekly_status)
  select coalesce(array_agg(p),'{}') into v_pdf from (
    select pdf_file_path p from public.evaluations where employee_id = v_target.id and pdf_file_path is not null
    union all
    select pdf_file_path p from public.creative_gene_weekly_status where employee_id = v_target.id and pdf_file_path is not null
  ) t;
  select count(*) into v_eval_ct from public.evaluations where employee_id = v_target.id;
  v_pdf_ct := coalesce(array_length(v_pdf,1),0);

  -- أرشفة الملخّص قبل الحذف
  insert into public.deleted_users_archive(original_user_id, full_name, email, role, department, department_id, evaluations_count, pdfs_count, deleted_by, deleted_by_name, deletion_reason)
    values(v_target.id, v_target.full_name, v_target.email, v_target.role, v_target.department, v_target.department_id, v_eval_ct, v_pdf_ct, v_actor.id, v_actor.full_name, p_reason);

  -- تصفير المراجع (NO ACTION) حيث المستخدم ليس صاحب السجل (لتمكين الحذف)
  update public.creative_gene_actions      set supervisor_id  = null where supervisor_id  = v_target.id;
  update public.creative_gene_objections   set reviewed_by    = null where reviewed_by    = v_target.id;
  update public.evaluations                set pdf_uploaded_by = null where pdf_uploaded_by = v_target.id;
  update public.creative_gene_weekly_status set pdf_uploaded_by = null where pdf_uploaded_by = v_target.id;
  update public.users                      set deleted_by     = null where deleted_by     = v_target.id;

  -- حذف سجلّات المستخدم (بوصفه صاحبها) في الجداول ذات NO ACTION
  delete from public.creative_gene_objections   where employee_id = v_target.id;
  delete from public.creative_gene_actions      where employee_id = v_target.id;
  delete from public.creative_gene_weekly_status where employee_id = v_target.id;

  -- ملاحظة: حذف ملفات PDF يتم من الواجهة عبر Storage API بعد نجاح هذه الدالة
  -- (Supabase يمنع حذف storage.objects عبر SQL). نُعيد المسارات ليحذفها الفرونت.

  -- حذف المستخدم — يتتالى تلقائياً: evaluations(employee_id), objections(employee_id),
  -- notifications, sessions, login_codes, employee_supervisor_history؛ ويُصفّر البقية (SET NULL)
  delete from public.users where id = v_target.id;

  -- تدقيق
  insert into public.audit_logs(id, user_id, user_name, role, action, entity_type, entity_id, details, "timestamp")
    values((select coalesce(max(id),0)+1 from public.audit_logs), v_actor.id, v_actor.full_name, v_actor.role,
      'delete_user_hard', 'users', v_target.id,
      jsonb_build_object('target_name',v_target.full_name,'target_email',v_target.email,'target_role',v_target.role,
                         'evaluations_deleted',v_eval_ct,'pdfs_deleted',v_pdf_ct,'supervisees_moved',v_sup,'reason',p_reason), now());

  return query select true,'ok','تم حذف المستخدم وجميع بياناته نهائياً', v_eval_ct, v_pdf_ct, v_pdf;
end; $$;

-- حذف ملفات PDF خادمياً وبأمان (أدمن فقط) عبر http + مفتاح service_role من Vault.
-- ⚠️ لا نمنح anon حذفاً على الحاوية (ثغرة). خطوة يدوية لمرّة واحدة قبل هذه الدالة:
--   delete from vault.secrets where name='storage_service_key';
--   select vault.create_secret('<SERVICE_ROLE_KEY>','storage_service_key','server-side storage deletion');
create or replace function public.delete_storage_pdfs(p_session_token text, p_paths text[])
returns table(deleted int, failed int)
language plpgsql security definer set search_path to 'public','extensions','vault'
as $fn$
declare v_sess record; v_actor public.users; v_key text;
  v_base text := 'https://hobhajqtgcyctfmcxkel.supabase.co/storage/v1/object/creative-gene-pdfs/';
  v_p text; v_status int; v_ok int := 0; v_bad int := 0;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select 0,0; return; end if;
  select * into v_actor from public.users where id = v_sess.user_id;
  if v_actor.role <> 'admin' then return query select 0,0; return; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name='storage_service_key' limit 1;
  if v_key is null then return query select 0, coalesce(array_length(p_paths,1),0); return; end if;
  foreach v_p in array coalesce(p_paths,'{}') loop
    begin
      select (r).status into v_status from extensions.http(('DELETE', v_base||replace(v_p,' ','%20'),
        array[extensions.http_header('Authorization','Bearer '||v_key), extensions.http_header('apikey',v_key)],
        null, null)::extensions.http_request) as r;
      if v_status between 200 and 299 then v_ok := v_ok+1; else v_bad := v_bad+1; end if;
    exception when others then v_bad := v_bad+1; end;
  end loop;
  return query select v_ok, v_bad;
end; $fn$;
grant execute on function public.delete_storage_pdfs(text, text[]) to anon, authenticated;

-- 4) قائمة أرشيف المحذوفين (أدمن فقط) — سجل فقط
create or replace function public.list_deleted_users_archive(p_session_token text)
returns table(id bigint, original_user_id bigint, full_name text, email text, role text,
              department text, evaluations_count int, pdfs_count int, deleted_at timestamptz, deleted_by_name text, deletion_reason text)
language plpgsql security definer set search_path to 'public'
as $$
declare v_sess record; v_actor public.users;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return; end if;
  select * into v_actor from public.users uu where uu.id = v_sess.user_id;
  if v_actor.role <> 'admin' then return; end if;
  return query select a.id, a.original_user_id, a.full_name, a.email, a.role, a.department,
    a.evaluations_count, a.pdfs_count, a.deleted_at, a.deleted_by_name, a.deletion_reason
    from public.deleted_users_archive a order by a.deleted_at desc;
end; $$;

grant execute on function public.get_user_deletion_preview(text, bigint) to anon, authenticated;
grant execute on function public.delete_user_completely(text, bigint, bigint, boolean, text) to anon, authenticated;
grant execute on function public.list_deleted_users_archive(text) to anon, authenticated;
