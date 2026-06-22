-- ============================================================================
-- المرحلة 2 (أمان) — تقوية delete_evaluation_cascade: الهوية من السيرفر فقط
-- ============================================================================
-- التغيير: الجسم يتجاهل p_actor_id/p_actor_name/p_actor_role القادمة من العميل
--   تماماً، ويشتقّ الهوية (actor) من الجلسة عبر verify_session حصراً.
--   التوقيع يبقى كما هو (نفس أسماء/أنواع المعاملات) → CREATE OR REPLACE بلا
--   DROP، فلا كسر لأي عميل، ولا حاجة لإعادة تحميل توقيع.
--   المعاملات p_actor_* أصبحت "ميتة" (تبقى للتوافق فقط) وتُحذف في المرحلة 2-ب.
-- ============================================================================

begin;

create or replace function public.delete_evaluation_cascade(
  p_eval_id       bigint,
  p_actor_id      bigint default null,   -- مُتجاهَل (للتوافق فقط) — الهوية من الجلسة
  p_actor_name    text   default null,   -- مُتجاهَل
  p_actor_role    text   default null,   -- مُتجاهَل
  p_session_token text   default null
) returns table(
  ok                 boolean,
  employee_name      text,
  deleted_objections int,
  message            text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eval       public.evaluations;
  v_emp_name   text;
  v_objs       int := 0;
  v_sess       record;
  v_actor_id   bigint;
  v_actor_name text;
  v_actor_role text;
  v_authed     boolean := false;
  v_allowed    constant text[] := array['admin','quality_officer'];
begin
  if p_eval_id is null then
    return query select false, null::text, 0, 'رقم التقييم مطلوب'::text; return;
  end if;

  -- الهوية تُشتقّ من السيرفر فقط (p_actor_* مُتجاهَلة)
  if p_session_token is not null then
    select * into v_sess from public.verify_session(p_session_token);
    if not coalesce(v_sess.is_valid, false) then
      return query select false, null::text, 0, 'انتهت الجلسة أو الرمز غير صالح'::text; return;
    end if;
    if not (v_sess.role = any(v_allowed)) then
      return query select false, null::text, 0, 'ليس لديك صلاحية لحذف التقييمات'::text; return;
    end if;
    v_actor_id := v_sess.user_id;
    v_actor_role := v_sess.role;
    v_authed := true;
    select full_name::text into v_actor_name from public.users where id = v_sess.user_id;
  else
    -- مسار انتقالي (يُزال في 2-ب)
    v_actor_id := null; v_actor_name := 'النظام'; v_actor_role := '-';
  end if;

  select * into v_eval from public.evaluations where id = p_eval_id;
  if v_eval.id is null then
    return query select false, null::text, 0, 'التقييم غير موجود'::text; return;
  end if;

  select full_name::text into v_emp_name from public.users where id = v_eval.employee_id;

  delete from public.objections where evaluation_id = p_eval_id;
  get diagnostics v_objs = row_count;
  delete from public.evaluations where id = p_eval_id;

  insert into public.audit_logs(id, user_id, user_name, role, action, entity_type, entity_id, details, "timestamp")
  values(
    (select coalesce(max(id),0)+1 from public.audit_logs),
    v_actor_id, coalesce(v_actor_name,'النظام'), coalesce(v_actor_role,'-'),
    'delete_evaluation', 'evaluation', p_eval_id,
    'حذف نهائي للتقييم #'||p_eval_id||' للموظف '||coalesce(v_emp_name,'-')||
      ' (مع '||v_objs||' اعتراض) — بواسطة '||coalesce(v_actor_name,'النظام')||
      case when v_authed then '' else ' [بدون مصادقة جلسة]' end,
    now()
  );

  return query select true, coalesce(v_emp_name,'-'), v_objs, 'تم الحذف نهائياً'::text;
end;
$$;

commit;
