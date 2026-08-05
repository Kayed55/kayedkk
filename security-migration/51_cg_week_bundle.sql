-- ============================================================================
-- PR #67-C — get_cg_week_bundle: دمج 3 round-trips لصفحة cg-week في استدعاء واحد
--   (status عبر منطق get_creative_gene_status + objections + actions) → jsonb واحد.
-- المصادر مؤكَّدة من pg_get_functiondef (Phase 1). get_creative_gene_status القديمة تبقى (rollback safety).
-- الأمان: verify_session + role IN (admin, quality_officer) — نفس نمط الدالة الأصلية. RLS qual=true (الأمن على مستوى الدالة).
-- تطبيق: شغّل الملف كاملاً في Supabase SQL Editor، ثم استعلامات التحقّق أسفله.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_cg_week_bundle(
  p_session_token text,
  p_week_start date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_sess record; v_ws date; v_we date;
  v_status jsonb; v_objections jsonb; v_actions jsonb;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then
    raise exception 'انتهت الجلسة أو الرمز غير صالح';
  end if;
  if not (v_sess.role in ('admin','quality_officer')) then
    raise exception 'ليس لديك صلاحية';
  end if;

  v_ws := coalesce(p_week_start, public.week_start_saturday());
  v_we := v_ws + 6;

  select coalesce(jsonb_agg(row_to_json(t) ORDER BY t.employee_name), '[]'::jsonb)
  into v_status
  from (
    select u.id::bigint as employee_id,
           u.full_name::text as employee_name,
           u.job_role::text,
           coalesce(s.status,'not_uploaded')::text as status,
           s.pdf_file_path::text,
           s.evaluation_id::bigint,
           e.percentage::numeric,
           v_ws as week_start, v_we as week_end
    from public.users u
    join public.evaluation_templates t
         on t.department_id = u.department_id and t.is_active
    left join public.creative_gene_weekly_status s
         on s.employee_id = u.id and s.week_start = v_ws
    left join public.evaluations e on e.id = s.evaluation_id
    where t.template_type = 'pdf_based_weekly'
      and u.role = 'employee'
      and coalesce(u.is_active,true)
  ) t;

  select coalesce(jsonb_agg(row_to_json(o)), '[]'::jsonb) into v_objections
  from public.creative_gene_objections o
  where exists (
    select 1 from public.creative_gene_weekly_status s
    where s.evaluation_id = o.evaluation_id
      and s.week_start = v_ws
  );

  select coalesce(jsonb_agg(row_to_json(a)), '[]'::jsonb) into v_actions
  from public.creative_gene_actions a
  where exists (
    select 1 from public.creative_gene_weekly_status s
    where s.evaluation_id = a.evaluation_id
      and s.week_start = v_ws
  );

  return jsonb_build_object(
    'status', v_status,
    'objections', v_objections,
    'actions', v_actions,
    'week_start', v_ws,
    'week_end', v_we
  );
end; $function$;

REVOKE ALL ON FUNCTION public.get_cg_week_bundle(text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cg_week_bundle(text, date) TO authenticated;

-- ============================================================================
-- تحقّق بعد التطبيق (إلزامي — درس السحب الصامت):
-- ============================================================================
-- 1) الدالة موجودة بالتوقيع الصحيح + GRANT صحيح:
--    SELECT proname, pg_get_function_arguments(oid),
--           has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_can_exec,
--           has_function_privilege('anon', oid, 'EXECUTE')          AS anon_can_exec
--    FROM pg_proc WHERE proname = 'get_cg_week_bundle';
--    -- متوقّع: auth_can_exec=true, anon_can_exec=false
--
-- 2) الأداء + استخدام الفهرس على EXISTS (استبدل التاريخ بأسبوع فيه بيانات):
--    EXPLAIN ANALYZE
--    SELECT public.get_cg_week_bundle(NULL, '2026-08-01'::date);
--    -- تحقّق: subplans لـobjections/actions تستخدم Index على creative_gene_weekly_status(week_start / evaluation_id)
--    --        (لو Seq Scan كبير → نضيف فهرساً في PR #69).
--
-- Rollback: DROP FUNCTION IF EXISTS public.get_cg_week_bundle(text, date);
--           (get_creative_gene_status القديمة لم تُمَسّ — cg-week يعمل عبر fallback العميل فوراً.)
