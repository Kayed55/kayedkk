-- ============================================================================
-- Migration 58 (PR #70) — review_objection: قبول اعتراض → soft-supersede + رجوع pending_supervisor (D6)
-- الأساس: الجسم الحرفي من الإنتاج (CSV 2026-08-06) + تعديلات نقطية:
--   ① متغيّر v_to_state
--   ② بدل الإغلاق غير المشروط: accepted/partial → supersede إجراء المشرف (supervisor_id NOT NULL) + workflow_state='pending_supervisor'
--      (approved_at=null, objection_deadline=null — لا نافذة اعتراض ثانية)؛  rejected → 'closed' (كما كان)
--   ③ wf_audit to_state → v_to_state
-- منطق إعادة احتساب الدرجات (accepted/partial + p_new_scores) + notifications + audit: verbatim. grants محفوظة.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.review_objection(p_session_token text, p_objection_id bigint, p_response text, p_decision text, p_new_scores jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(ok boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sess record; v_obj public.creative_gene_objections; v_actor text; v_status_id bigint;
  v_eval public.evaluations; v_tpl jsonb; v_calc jsonb; v_meta jsonb; v_rescored boolean := false;
  v_pass numeric;  -- ★ #6: عتبة النجاح الفعلية
  v_to_state text; -- ★ #70
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,'انتهت الجلسة'::text; return; end if;
  if v_sess.role not in ('quality_officer','admin') then return query select false,'مراجعة الاعتراض للجودة أو المدير فقط'::text; return; end if;
  if p_decision not in ('accepted','partial','rejected') then return query select false,'القرار غير صالح (قبول/قبول جزئي/رفض)'::text; return; end if;
  if coalesce(trim(coalesce(p_response,'')),'')='' then return query select false,'نص الرد مطلوب'::text; return; end if;
  select * into v_obj from public.creative_gene_objections where id = p_objection_id;
  if v_obj.id is null then return query select false,'الاعتراض غير موجود'::text; return; end if;
  if v_obj.status <> 'pending' then return query select false,'تمت مراجعة هذا الاعتراض مسبقاً'::text; return; end if;

  v_meta := jsonb_build_object('decision', p_decision);
  -- تعديل الدرجات (قبول/قبول جزئي) مع الاحتفاظ بالقديم للتاريخ داخل السجل
  if p_decision in ('accepted','partial') and p_new_scores is not null and p_new_scores <> '{}'::jsonb then
    select * into v_eval from public.evaluations where id = v_obj.evaluation_id;
    if v_eval.id is null then return query select false,'التقييم غير موجود'::text; return; end if;
    v_tpl := v_eval.template_snapshot;                 -- نفس القالب القديم يُحفظ كما هو
    -- ★ #6: عتبة النجاح — اللقطة المجمّدة أولاً، ثم عتبة قسم الموظف، ثم 85 (Option A)
    v_pass := coalesce(v_eval.pass_score_snapshot, public.employee_pass_score(v_eval.employee_id), 85);
    v_calc := public.compute_pdf_weighted(p_new_scores, v_tpl, v_pass);  -- ★ #6: كان بمعاملَين (يقع على 85)
    v_meta := v_meta || jsonb_build_object('rescored', true,
              'new_percentage', (v_calc->>'percentage'),
              'history', jsonb_build_object('old_section_scores', v_eval.section_scores,
                        'old_percentage', v_eval.percentage, 'old_total', v_eval.total_score,
                        'template_version', v_eval.template_version, 'template_snapshot', v_eval.template_snapshot));
    update public.evaluations set section_scores=p_new_scores,
       total_score=(v_calc->>'total_score')::numeric, percentage=(v_calc->>'percentage')::numeric,
       grade=v_calc->>'grade', updated_at=now()
     where id=v_eval.id;
    v_rescored := true;
  end if;

  update public.creative_gene_objections set status=p_decision, reviewer_response=trim(p_response),
     reviewed_by=v_sess.user_id, reviewed_at=now() where id=p_objection_id;

  -- ★ #70 (D6): قبول (كلي/جزئي) → الغِ إجراء المشرف (soft-supersede) + رجوع pending_supervisor بلا مهلة جديدة؛ رفض → إغلاق
  if p_decision in ('accepted','partial') then
    update public.creative_gene_actions set superseded_at=now()
      where evaluation_id=v_obj.evaluation_id and supervisor_id is not null and superseded_at is null;
    update public.creative_gene_weekly_status
       set status='objection_reviewed', workflow_state='pending_supervisor', approved_at=null, objection_deadline=null, updated_at=now()
     where evaluation_id=v_obj.evaluation_id returning id into v_status_id;
    v_to_state := 'pending_supervisor';
  else
    update public.creative_gene_weekly_status
       set status='objection_reviewed', workflow_state='closed', updated_at=now()
     where evaluation_id=v_obj.evaluation_id returning id into v_status_id;
    v_to_state := 'closed';
  end if;

  perform public.wf_audit(v_status_id, v_obj.evaluation_id, 'objection_raised', v_to_state, 'review', v_sess.user_id, v_sess.role, p_response, v_meta);  -- ★ #70 to_state = v_to_state
  insert into public.notifications(id,user_id,title,message,type,entity_type,entity_id,is_read,created_at)
  values((select coalesce(max(id),0)+1 from public.notifications), v_obj.employee_id, 'تمت مراجعة اعتراضك',
    'قرار الجودة: '||(case p_decision when 'accepted' then 'قبول' when 'partial' then 'قبول جزئي' else 'رفض' end)||
      case when v_rescored then ' (عُدّلت الدرجة)' else '' end,
    case when p_decision='rejected' then 'warning' else 'success' end, 'evaluation', v_obj.evaluation_id, false, now());
  select full_name::text into v_actor from public.users where id=v_sess.user_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
    'review_objection','evaluation',v_obj.evaluation_id,'مراجعة اعتراض #'||p_objection_id||' — '||p_decision||case when v_rescored then ' (تعديل درجات)' else '' end||' — بواسطة '||coalesce(v_actor,'النظام'),now());
  return query select true, ('تم حفظ قرار المراجعة'||case when v_rescored then ' وتعديل الدرجات' else '' end)::text;
end; $function$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='review_objection' AND pronamespace='public'::regnamespace) THEN
    RAISE EXCEPTION 'Migration 58 failed — review_objection missing';
  END IF;
  RAISE NOTICE 'Migration 58 OK — review_objection: accept→supersede+pending_supervisor, reject→closed';
END $$;

COMMIT;

-- Rollback: أعد الجسم الحرفي الأصلي (إغلاق غير مشروط workflow_state='closed' لكل القرارات، بلا supersede).
