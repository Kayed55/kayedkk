-- ============================================================================
-- Migration 59 (PR #70) — get_cg_evaluation_timeline: bundle لشاشة تفاصيل تقييم CG
-- يعيد: evaluation + status + actions[] + objections[] + audit[] + permissions.
-- يتضمّن auto-close on-read (D7). Anon-model: verify_session + GRANT anon.
-- ملاحظات مؤكَّدة: workflow_audit_log(weekly_status_id, evaluation_id, from_state, to_state,
--   action_type, actor_id, actor_role, notes, metadata) · لا closed_at · users.full_name/supervisor_id.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_cg_evaluation_timeline(
  p_session_token text,
  p_evaluation_id bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_sess record;
  v_eval record;
  v_status record;
  v_should_close boolean;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid, false) then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  select * into v_eval from public.evaluations where id = p_evaluation_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- تحقّق الصلاحية: الموظف لتقييمه فقط · المشرف لموظفيه · quality_officer/admin للكل
  if v_sess.role = 'employee' and v_sess.user_id <> v_eval.employee_id then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  elsif v_sess.role = 'supervisor' and not exists (
      select 1 from public.users u
      where u.id = v_eval.employee_id and u.supervisor_id = v_sess.user_id
    ) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  elsif v_sess.role not in ('employee','supervisor','quality_officer','admin') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_status from public.creative_gene_weekly_status
    where evaluation_id = p_evaluation_id;

  -- Auto-close on-read (D7): approved + انقضت المهلة + لا اعتراض معلّق → closed
  v_should_close := (
    v_status.workflow_state = 'approved'
    and v_status.objection_deadline is not null
    and v_status.objection_deadline < now()
    and not exists (
      select 1 from public.creative_gene_objections
      where evaluation_id = p_evaluation_id and status = 'pending'
    )
  );
  if v_should_close then
    update public.creative_gene_weekly_status
      set workflow_state = 'closed', updated_at = now()
      where evaluation_id = p_evaluation_id;
    perform public.wf_audit(
      v_status.id, p_evaluation_id, 'approved', 'closed', 'cg_auto_closed_expired',
      v_sess.user_id, v_sess.role, null,
      jsonb_build_object('reason', 'objection_deadline_passed')
    );
    select * into v_status from public.creative_gene_weekly_status
      where evaluation_id = p_evaluation_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'evaluation', row_to_json(v_eval),
    'status',     row_to_json(v_status),
    'actions', coalesce((
      select jsonb_agg(row_to_json(a) order by a.taken_at)
      from public.creative_gene_actions a where a.evaluation_id = p_evaluation_id
    ), '[]'::jsonb),
    'objections', coalesce((
      select jsonb_agg(row_to_json(o) order by o.raised_at)
      from public.creative_gene_objections o where o.evaluation_id = p_evaluation_id
    ), '[]'::jsonb),
    -- audit مرتّب زمنياً بـcreated_at (workflow_audit_log.id هو uuid عشوائي — لا يصلح للترتيب)
    'audit', coalesce((
      select jsonb_agg(row_to_json(w) order by w.created_at)
      from public.workflow_audit_log w where w.evaluation_id = p_evaluation_id
    ), '[]'::jsonb),
    'permissions', jsonb_build_object(
      'can_object',
        v_sess.role = 'employee'
        and v_sess.user_id = v_eval.employee_id
        and v_status.workflow_state in ('pending_supervisor','approved')
        and v_status.objection_deadline is not null
        and v_status.objection_deadline > now()
        and not exists (
          select 1 from public.creative_gene_objections
          where evaluation_id = p_evaluation_id
        ),
      'can_commit_action',
        v_sess.role in ('supervisor','admin')
        and v_status.workflow_state = 'pending_supervisor',
      'can_review_objection',
        v_sess.role in ('quality_officer','admin')
        and v_status.workflow_state = 'objection_raised'
    )
  );
end; $function$;

-- Anon-model contract: العميل anon يستدعيها
REVOKE ALL ON FUNCTION public.get_cg_evaluation_timeline(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cg_evaluation_timeline(text, bigint) TO anon, authenticated;

-- Self-verify
DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.get_cg_evaluation_timeline(text,bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 59 failed — anon cannot execute get_cg_evaluation_timeline';
  END IF;
  RAISE NOTICE 'Migration 59 OK — timeline bundle created, anon_exec=true';
END $$;

COMMIT;

-- Rollback: DROP FUNCTION IF EXISTS public.get_cg_evaluation_timeline(text, bigint);
