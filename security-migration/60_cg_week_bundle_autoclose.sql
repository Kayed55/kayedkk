-- ============================================================================
-- Migration 60 (PR #70) — get_cg_week_bundle + auto-close on-read (D7)
-- الأساس: نسخة M51 الحرفية (لم يُعِد تعريفها أي migration لاحق) + block إغلاق تلقائي في البداية.
-- لا يمسّ عمود status (فقط workflow_state) لتفادي كسر أي CHECK محتمل. لا closed_at (غير موجود).
-- ============================================================================

BEGIN;

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

  -- ★ #70 (D7): إغلاق تلقائي on-read للتقييمات المعتمدة التي انقضت مهلة اعتراضها بلا اعتراض معلّق
  update public.creative_gene_weekly_status
    set workflow_state = 'closed', updated_at = now()
    where workflow_state = 'approved'
      and objection_deadline is not null
      and objection_deadline < now()
      and not exists (
        select 1 from public.creative_gene_objections o
        where o.evaluation_id = creative_gene_weekly_status.evaluation_id
          and o.status = 'pending'
      );

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
    where s.evaluation_id = o.evaluation_id and s.week_start = v_ws
  );

  select coalesce(jsonb_agg(row_to_json(a)), '[]'::jsonb) into v_actions
  from public.creative_gene_actions a
  where exists (
    select 1 from public.creative_gene_weekly_status s
    where s.evaluation_id = a.evaluation_id and s.week_start = v_ws
  );

  return jsonb_build_object(
    'status', v_status, 'objections', v_objections, 'actions', v_actions,
    'week_start', v_ws, 'week_end', v_we
  );
end; $function$;

-- Anon-model contract: العميل anon (get_cg_week_bundle يُستدعى منه) — أبقِ anon (CREATE OR REPLACE يحفظ الـgrants، ونؤكّدها صراحةً)
REVOKE ALL ON FUNCTION public.get_cg_week_bundle(text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cg_week_bundle(text, date) TO anon, authenticated;

-- Self-verify: anon قابل للتنفيذ (وإلا يتعطّل cg-week)
DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.get_cg_week_bundle(text,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 60 failed — anon cannot execute get_cg_week_bundle';
  END IF;
  RAISE NOTICE 'Migration 60 OK — auto-close added, anon_exec=true';
END $$;

COMMIT;

-- Rollback: أعد تطبيق نسخة M51 (بدون block الإغلاق) من git — security-migration/51_cg_week_bundle.sql
