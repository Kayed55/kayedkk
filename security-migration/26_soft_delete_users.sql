-- م18: حذف المستخدمين (Soft Delete) — مُكيَّف على المخطط الفعلي
-- users.id = bigint · مصادقة جلسات (verify_session) · تدقيق في audit_logs · ربط المشرف supervisor_id
-- غير مدمّر: يضيف أعمدة، يعيد بناء view، ويضيف دوال RPC جديدة.

-- 1) أعمدة الحذف الناعم
alter table public.users add column if not exists deleted_at timestamptz;
alter table public.users add column if not exists deleted_by bigint references public.users(id);

-- 2) إعادة بناء users_public لاستثناء المحذوفين (المصدر الرئيسي لقائمة المستخدمين + pullAll)
create or replace view public.users_public as
 select id, username, email, full_name, phone, role, department, "position",
        employee_number, supervisor_name, supervisor_id, is_active, must_change_password,
        password_changed_at, password_reset_at, created_at, updated_at, department_id,
        hire_date, last_login_at, notes, job_role, job_title,
        coalesce(email_notifications_enabled, true) as email_notifications_enabled
   from public.users
  where deleted_at is null;

-- 3) دالة الحذف
create or replace function public.delete_user(
  p_session_token text,
  p_user_id bigint,
  p_transfer_supervisees_to bigint default null,
  p_unlink_supervisees boolean default false
) returns table(ok boolean, code text, message text)
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_sess record; v_actor public.users; v_target public.users; v_sup_count int; v_new_sup public.users;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid, false) then
    return query select false, 'session', 'انتهت الجلسة'; return;
  end if;
  select * into v_actor from public.users where id = v_sess.user_id;
  -- صلاحية الحاذف
  if v_actor.role not in ('admin','quality_officer') then
    return query select false, 'forbidden', 'ليس لديك صلاحية حذف المستخدمين'; return;
  end if;
  -- الهدف موجود وغير محذوف
  select * into v_target from public.users where id = p_user_id and deleted_at is null;
  if v_target.id is null then
    return query select false, 'not_found', 'المستخدم غير موجود أو محذوف مسبقاً'; return;
  end if;
  -- منع حذف النفس
  if v_target.id = v_actor.id then
    return query select false, 'self', 'لا يمكنك حذف حسابك الخاص'; return;
  end if;
  -- قيود موظف الجودة: لا يحذف مديراً ولا موظف جودة آخر
  if v_actor.role = 'quality_officer' and v_target.role in ('admin','quality_officer') then
    return query select false, 'forbidden', 'موظف الجودة لا يمكنه حذف مدير أو موظف جودة'; return;
  end if;
  -- المشرف الذي له موظفون (غير محذوفين)
  select count(*) into v_sup_count from public.users where supervisor_id = v_target.id and deleted_at is null;
  if v_sup_count > 0 then
    if p_transfer_supervisees_to is not null then
      select * into v_new_sup from public.users where id = p_transfer_supervisees_to and deleted_at is null;
      if v_new_sup.id is null then
        return query select false, 'bad_transfer', 'المشرف البديل غير موجود'; return;
      end if;
      if v_new_sup.id = v_target.id then
        return query select false, 'bad_transfer', 'لا يمكن النقل إلى المشرف نفسه'; return;
      end if;
      update public.users set supervisor_id = v_new_sup.id, supervisor_name = v_new_sup.full_name
        where supervisor_id = v_target.id and deleted_at is null;
    elsif p_unlink_supervisees then
      update public.users set supervisor_id = null, supervisor_name = null
        where supervisor_id = v_target.id and deleted_at is null;
    else
      -- تحتاج الواجهة نقل الموظفين أولاً
      return query select false, 'require_transfer', ('لدى هذا المشرف ' || v_sup_count || ' موظفاً — انقلهم لمشرف آخر أو أزِل الربط'); return;
    end if;
  end if;
  -- الحذف الناعم
  update public.users set deleted_at = now(), deleted_by = v_actor.id, is_active = false where id = v_target.id;
  -- إنهاء كل جلسات المستخدم المحذوف (طرد فوري)
  delete from public.sessions where user_id = v_target.id;
  -- تدقيق
  insert into public.audit_logs(id, user_id, user_name, role, action, entity_type, entity_id, details, "timestamp")
    values((select coalesce(max(id),0)+1 from public.audit_logs), v_actor.id, v_actor.full_name, v_actor.role, 'delete_user', 'users', v_target.id,
      jsonb_build_object('target_name', v_target.full_name, 'target_email', v_target.email,
                         'target_role', v_target.role, 'target_department', v_target.department,
                         'supervisees_moved', v_sup_count), now());
  return query select true, 'ok', 'تم حذف المستخدم';
end; $$;

-- 4) دالة الاستعادة (أدمن فقط)
create or replace function public.restore_user(p_session_token text, p_user_id bigint)
returns table(ok boolean, message text)
language plpgsql security definer set search_path to 'public'
as $$
declare v_sess record; v_actor public.users; v_target public.users;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid, false) then return query select false, 'انتهت الجلسة'; return; end if;
  select * into v_actor from public.users where id = v_sess.user_id;
  if v_actor.role <> 'admin' then return query select false, 'الاستعادة للمدير فقط'; return; end if;
  select * into v_target from public.users where id = p_user_id and deleted_at is not null;
  if v_target.id is null then return query select false, 'المستخدم غير موجود ضمن المحذوفين'; return; end if;
  update public.users set deleted_at = null, deleted_by = null, is_active = true where id = v_target.id;
  insert into public.audit_logs(id, user_id, user_name, role, action, entity_type, entity_id, details, "timestamp")
    values((select coalesce(max(id),0)+1 from public.audit_logs), v_actor.id, v_actor.full_name, v_actor.role, 'restore_user', 'users', v_target.id,
      jsonb_build_object('target_name', v_target.full_name, 'target_role', v_target.role), now());
  return query select true, 'تمت استعادة المستخدم';
end; $$;

-- 5) قائمة المحذوفين (أدمن فقط)
create or replace function public.list_deleted_users(p_session_token text)
returns table(id bigint, full_name text, email text, role text, department text,
              deleted_at timestamptz, deleted_by_name text)
language plpgsql security definer set search_path to 'public'
as $$
declare v_sess record; v_actor public.users;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid, false) then return; end if;
  select * into v_actor from public.users uu where uu.id = v_sess.user_id;
  if v_actor.role <> 'admin' then return; end if;
  return query
    select u.id, u.full_name::text, u.email::text, u.role::text, u.department::text,
           u.deleted_at, d.full_name::text
      from public.users u
      left join public.users d on d.id = u.deleted_by
     where u.deleted_at is not null
     order by u.deleted_at desc;
end; $$;

-- 6) صلاحيات التنفيذ (الفرونت يستدعي عبر anon + session token، مثل بقية الدوال)
grant execute on function public.delete_user(text, bigint, bigint, boolean) to anon, authenticated;
grant execute on function public.restore_user(text, bigint) to anon, authenticated;
grant execute on function public.list_deleted_users(text) to anon, authenticated;
