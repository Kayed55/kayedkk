-- ============================================================================
-- المرحلة 6: حذف التقييم حذفاً متزامناً (Cascade) عبر دالة ذرّية واحدة
-- ============================================================================
-- المشكلة:
--   طبقة المزامنة تدفع بـ upsert فقط (لا تحذف)، فحذف التقييم محلياً يبقى في
--   Supabase، ويعيده أول pull/Realtime إلى كل الأقسام (تقارير/لوحة/ملف الموظف…).
--   كما أن الاعتراضات المرتبطة (objections.evaluation_id) تبقى يتيمة.
--
-- الحل:
--   دالة RPC واحدة SECURITY DEFINER تحذف داخل معاملة ذرّية:
--     1) objections المرتبطة بالتقييم
--     2) صفّ التقييم نفسه (يحمل البنود/الإجراء/الأخطاء كحقول داخله)
--   ثم تكتب سطر تدقيق (audit_logs) باسم المنفّذ والتاريخ ورقم التقييم واسم الموظف.
--
-- ملاحظة: notifications لا تملك عمود evaluation_id (الربط نصّي فقط)، فلا تُحذف
--   تلقائياً لتفادي حذف إشعارات غير مرتبطة بالخطأ. (إشعارات غير ضارّة تبقى).
-- ============================================================================

begin;

create or replace function public.delete_evaluation_cascade(
  p_eval_id    bigint,
  p_actor_id   bigint default null,
  p_actor_name text   default null,
  p_actor_role text   default null
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
  v_eval     public.evaluations;
  v_emp_name text;
  v_objs     int := 0;
begin
  if p_eval_id is null then
    return query select false, null::text, 0, 'رقم التقييم مطلوب'::text; return;
  end if;

  select * into v_eval from public.evaluations where id = p_eval_id;
  if v_eval.id is null then
    return query select false, null::text, 0, 'التقييم غير موجود'::text; return;
  end if;

  select full_name::text into v_emp_name from public.users where id = v_eval.employee_id;

  -- 1) حذف الاعتراضات المرتبطة
  delete from public.objections where evaluation_id = p_eval_id;
  get diagnostics v_objs = row_count;

  -- 2) حذف التقييم نفسه
  delete from public.evaluations where id = p_eval_id;

  -- 3) سطر تدقيق (id يُحسب كنمط العميل: max+1)
  insert into public.audit_logs(id, user_id, user_name, role, action, entity_type, entity_id, details, "timestamp")
  values(
    (select coalesce(max(id),0)+1 from public.audit_logs),
    p_actor_id,
    coalesce(p_actor_name,'النظام'),
    coalesce(p_actor_role,'-'),
    'delete_evaluation',
    'evaluation',
    p_eval_id,
    'حذف نهائي للتقييم #'||p_eval_id||' للموظف '||coalesce(v_emp_name,'-')||
      ' (مع '||v_objs||' اعتراض مرتبط) — بواسطة '||coalesce(p_actor_name,'النظام'),
    now()
  );

  return query select true, coalesce(v_emp_name,'-'), v_objs, 'تم الحذف نهائياً'::text;
end;
$$;

revoke all on function public.delete_evaluation_cascade(bigint,bigint,text,text) from public;
grant execute on function public.delete_evaluation_cascade(bigint,bigint,text,text) to anon, authenticated;

commit;

-- ============================================================================
-- التحقّق:
--   select * from public.delete_evaluation_cascade(999999, 1, 'مدير النظام', 'admin');
--   -- المتوقّع: ok=false, message='التقييم غير موجود' (لا أخطاء نوع)
-- ============================================================================
