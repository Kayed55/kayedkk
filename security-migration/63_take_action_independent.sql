-- ============================================================================
-- Migration 63 (PR #71) — take_action: مسار المشرف مستقل (Q4)
-- الأساس: جسم PR #70 (M56) الحيّ + تعديل واحد:
--   ① أُزيل تحديث workflow_state/approved_at/deadline نهائياً — المشرف يسجّل إجراءه فقط، لا يحجز حالة.
--      wf_audit يسجّل 'supervisor_action' بلا انتقال حالة (from=to=الحالة الحالية).
-- بحث إجراء المشرف النشط (supervisor_id NOT NULL AND superseded_at IS NULL) + notifications + audit + notify_eval_approved: كما هو.
-- عقد anon-only صريح (REVOKE PUBLIC + GRANT anon).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.take_action(p_session_token text, p_evaluation_id bigint, p_action_type text, p_action_details text, p_linked_objection_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(ok boolean, action_id bigint, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sess record; v_eval public.evaluations; v_id bigint; v_sup bigint; v_actor text; v_allowed jsonb; v_status_id bigint;
  v_existing_id bigint; v_old_type text; v_old_details text; v_meta jsonb;
  v_wf text;  -- ★ #71
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,null::bigint,'انتهت الجلسة'::text; return; end if;
  if not (v_sess.role in ('admin','supervisor')) then return query select false,null::bigint,'اتخاذ الإجراء للمشرف أو المدير فقط'::text; return; end if;
  select * into v_eval from public.evaluations where id = p_evaluation_id;
  if v_eval.id is null then return query select false,null::bigint,'التقييم غير موجود'::text; return; end if;
  if v_eval.template_type <> 'pdf_based_weekly' then return query select false,null::bigint,'الإجراء متاح لتقييمات Creative Gene فقط'::text; return; end if;
  if coalesce(trim(p_action_type),'') = '' or coalesce(trim(p_action_details),'') = '' then return query select false,null::bigint,'نوع الإجراء وتفاصيله مطلوبة'::text; return; end if;
  if v_sess.role = 'supervisor' then
    select supervisor_id into v_sup from public.users where id = v_eval.employee_id;
    if v_sup is distinct from v_sess.user_id then return query select false,null::bigint,'يمكنك اتخاذ إجراء لموظفيك فقط'::text; return; end if;
  end if;
  v_allowed := coalesce(v_eval.template_snapshot->'allowed_action_types','["warning","training","praise","other"]'::jsonb);
  if not (v_allowed ? p_action_type) then return query select false,null::bigint,'نوع إجراء غير مسموح'::text; return; end if;
  -- ★ #70 (Option B): استهدف إجراء المشرف النشط فقط (supervisor_id NOT NULL) — لا نلمس صف توصية الجودة (supervisor_id NULL)
  --   أول إجراء مشرف → INSERT جديد (يبقى qo_suggestion مستقلاً)؛ تعديل قبل الاعتراض → UPDATE؛ بعد supersede → INSERT جديد.
  select id, action_type, action_details into v_existing_id, v_old_type, v_old_details from public.creative_gene_actions where evaluation_id=p_evaluation_id and supervisor_id is not null and superseded_at is null order by id desc limit 1;
  if v_existing_id is not null then
    update public.creative_gene_actions set action_type=p_action_type, action_details=trim(p_action_details), supervisor_id=v_sess.user_id, taken_at=now(), linked_objection_id=coalesce(p_linked_objection_id, linked_objection_id) where id=v_existing_id;
    v_id := v_existing_id;
  else
    insert into public.creative_gene_actions(evaluation_id, employee_id, supervisor_id, created_by, action_type, action_details, linked_objection_id)
    values(p_evaluation_id, v_eval.employee_id, v_sess.user_id, v_sess.user_id, p_action_type, trim(p_action_details), p_linked_objection_id) returning id into v_id;
  end if;
  -- ★ #71 (Q4): المشرف مستقل تماماً — لا يغيّر workflow_state ولا objection_deadline ولا approved_at؛ فقط يسجّل إجراءه.
  select id, workflow_state into v_status_id, v_wf from public.creative_gene_weekly_status where evaluation_id = p_evaluation_id;
  v_meta := jsonb_build_object('action_type', p_action_type);
  if v_existing_id is not null and (v_old_type is distinct from p_action_type or v_old_details is distinct from trim(p_action_details)) then
    v_meta := v_meta || jsonb_build_object('action_edited', true, 'old_action_type', v_old_type, 'old_action_details', v_old_details);
  end if;
  perform public.wf_audit(v_status_id, p_evaluation_id, coalesce(v_wf,'approved'), coalesce(v_wf,'approved'), 'supervisor_action', v_sess.user_id, v_sess.role, trim(p_action_details), v_meta);  -- ★ #71 بلا انتقال حالة
  insert into public.notifications(id,user_id,title,message,type,entity_type,entity_id,is_read,created_at)
  values((select coalesce(max(id),0)+1 from public.notifications), v_eval.employee_id, 'تم اعتماد تقييمك واتخاذ إجراء',
    'اعتُمد تقييمك مع إجراء: '||p_action_type, 'warning','evaluation',p_evaluation_id,false,now());
  select full_name::text into v_actor from public.users where id=v_sess.user_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
    'take_action','evaluation',p_evaluation_id,'اعتماد+إجراء ('||p_action_type||') لتقييم #'||p_evaluation_id||coalesce(case when v_meta ? 'action_edited' then ' [عُدّل]' else '' end,'')||' — بواسطة '||coalesce(v_actor,'النظام'),now());
  begin perform public.notify_eval_approved(p_evaluation_id); exception when others then null; end;
  return query select true, v_id, 'تم اعتماد التقييم وتسجيل الإجراء'::text;
end; $function$;

-- ★ #71: عقد anon-only صريح
REVOKE ALL ON FUNCTION public.take_action(text, bigint, text, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.take_action(text, bigint, text, text, bigint) TO anon, authenticated;

DO $$
DECLARE v_sig text := 'public.take_action(text, bigint, text, text, bigint)';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='take_action' AND pronamespace='public'::regnamespace) THEN
    RAISE EXCEPTION 'Migration 63 failed — take_action missing';
  END IF;
  IF has_function_privilege('public', v_sig, 'EXECUTE') THEN RAISE EXCEPTION 'Migration 63 failed — PUBLIC still can execute'; END IF;
  IF NOT has_function_privilege('anon', v_sig, 'EXECUTE') THEN RAISE EXCEPTION 'Migration 63 failed — anon cannot execute'; END IF;
  RAISE NOTICE 'Migration 63 OK — take_action independent (no state change), anon-only';
END $$;

COMMIT;

-- Rollback: أعد جسم M56 (يُحدّث workflow_state=v_new_state + approved_at).
