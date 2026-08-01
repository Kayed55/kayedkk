-- #6: pass pass_score to compute_pdf_weighted (was defaulting to 85)
-- =========================================================================
-- 44_review_objection_pass_score.sql  (#6 — تمرير عتبة النجاح في مراجعة الاعتراض)
--
-- العلّة: review_objection كانت تستدعي compute_pdf_weighted(p_new_scores, v_tpl)
-- بمعاملَين فقط → تقع على p_pass_score الافتراضي 85. فعند تعديل درجات CG أثناء
-- مراجعة اعتراض، يُعاد احتساب grade على 85 بدل عتبة القسم (CG=90):
-- تقييم 85–89 يظهر «ناجح» خطأً بدل «راسب».
--
-- الإصلاح (Option A — يطابق update_evaluation ملف 30 و admin_update_cg_evaluation ملف 31):
--   v_pass := coalesce(v_eval.pass_score_snapshot, public.employee_pass_score(v_eval.employee_id), 85);
--   ثم تمرير v_pass كمعامل ثالث.
-- المتن حرفي من الحيّ عدا: (1) v_pass في declare، (2) سطر حساب v_pass، (3) الاستدعاء 3-معاملات.
-- لا لمس لأي منطق آخر (audit/notifications/status/history). المرجع: #6. التاريخ: 2026-08-01.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.review_objection(p_session_token text, p_objection_id bigint, p_response text, p_decision text, p_new_scores jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(ok boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sess record; v_obj public.creative_gene_objections; v_actor text; v_status_id bigint;
  v_eval public.evaluations; v_tpl jsonb; v_calc jsonb; v_meta jsonb; v_rescored boolean := false;
  v_pass numeric;  -- ★ #6: عتبة النجاح الفعلية
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
  update public.creative_gene_weekly_status set status='objection_reviewed', workflow_state='closed', updated_at=now()
     where evaluation_id=v_obj.evaluation_id returning id into v_status_id;
  perform public.wf_audit(v_status_id, v_obj.evaluation_id, 'objection_raised', 'closed', 'review', v_sess.user_id, v_sess.role, p_response, v_meta);
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

-- المنح (نمط ملفات 34/43: عن PUBLIC، متاح لـ anon/authenticated)
REVOKE ALL ON FUNCTION public.review_objection(text,bigint,text,text,jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.review_objection(text,bigint,text,text,jsonb) TO anon, authenticated;
