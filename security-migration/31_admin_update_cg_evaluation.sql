-- ============================================================
-- ملف 31 (م20-ب): مسار تعديل مخصّص لتقييمات كريتف جين (PDF)
-- ============================================================
-- السياق: admin_update_evaluation (القطاعية) مثبّتة على section_based وتُتلف
-- تقييمات CG عند التعديل (م20 المرحلة 1 حرست العميل مؤقتاً). هذا الملف يضيف
-- دالة تعديل CG صحيحة تحاكي فرع PDF في create_evaluation (ملف 30):
--   • تتحقّق من الجلسة والدور، وتحصر النوع في pdf_based_weekly.
--   • تجمّد pass_score (نمط م19): snapshot الموجود → عتبة الموظف → 85.
--   • تحتسب عبر compute_pdf_weighted بالعتبة المجمّدة.
--   • لا تلمس creative_gene_objections ولا creative_gene_weekly_status
--     (قرار م20-ب: الاعتراضات تبقى لمسارها الطبيعي review_objection).
--
-- انحرافان مقصودان عن مسودة المواصفة (للصحة/الاتساق):
--   • المنح: to anon, authenticated (العميل يتصل بمفتاح anon + رمز جلسة —
--     كنمط create_evaluation/admin_update_evaluation الفعلي).
--   • حد التحقّق: 0..weight (كما في create_evaluation وقصّ compute_pdf_weighted)،
--     لا min..max — تفادياً لتخزين درجة تتجاوز ما يُحتسب فعلياً.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_update_cg_evaluation(
  p_session_token    text,
  p_eval_id          bigint,
  p_criteria_scores  jsonb,
  p_evaluation_notes text DEFAULT NULL
)
 RETURNS TABLE(ok boolean, percentage numeric, grade text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sess record; v_actor text; v_emp text; v_eval public.evaluations;
  v_template jsonb; v_calc jsonb; v_pass numeric;
  c jsonb; v_key text; v_cs numeric; v_cw numeric; v_found boolean;
  v_allowed constant text[] := array['admin','quality_officer'];
begin
  -- 1) مصادقة (نمط review_objection)
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then
    return query select false, null::numeric, null::text, 'انتهت الجلسة أو الرمز غير صالح'::text; return;
  end if;
  if not (v_sess.role = any(v_allowed)) then
    return query select false, null::numeric, null::text, 'ليس لديك صلاحية لتعديل التقييمات'::text; return;
  end if;

  -- 2) جلب التقييم وحصر النوع في PDF
  select * into v_eval from public.evaluations where id = p_eval_id;
  if v_eval.id is null then
    return query select false, null::numeric, null::text, 'التقييم غير موجود'::text; return;
  end if;
  if coalesce(v_eval.template_type,'') <> 'pdf_based_weekly' then
    return query select false, null::numeric, null::text, 'هذه الدالة للتقييمات القائمة على PDF فقط'::text; return;
  end if;
  if p_criteria_scores is null or jsonb_typeof(p_criteria_scores) <> 'object' or p_criteria_scores = '{}'::jsonb then
    return query select false, null::numeric, null::text, 'درجات المعايير مطلوبة'::text; return;
  end if;

  -- 3) تجميد العتبة (نمط م19)
  v_pass := coalesce(v_eval.pass_score_snapshot, public.employee_pass_score(v_eval.employee_id), 85);

  -- 4) مصدر النموذج: اللقطة المُجمّدة أولاً (اتساق تاريخي)، وإلا النموذج النشط
  v_template := coalesce(
    v_eval.template_snapshot,
    (select template_jsonb from public.evaluation_templates
      where template_type='pdf_based_weekly' and is_active limit 1));
  if v_template is null then
    return query select false, null::numeric, null::text, 'تعذّر تحديد نموذج التقييم'::text; return;
  end if;

  -- 5) التحقّق: كل مفتاح معيار موجود في النموذج، والقيمة ضمن 0..weight
  for v_key in select jsonb_object_keys(p_criteria_scores) loop
    v_found := false;
    for c in select value from jsonb_array_elements(coalesce(v_template->'criteria','[]'::jsonb)) loop
      if (c->>'id') = v_key then
        v_found := true;
        v_cw := coalesce((c->>'weight')::numeric, 0);
        v_cs := coalesce((p_criteria_scores->>v_key)::numeric, 0);
        if v_cs < 0 or v_cs > v_cw then
          return query select false, null::numeric, null::text,
            ('الدرجة المُدخلة ('||v_cs||') خارج النطاق المسموح لمعيار «'||(c->>'name')||'» (0 - '||v_cw||')')::text;
          return;
        end if;
        exit;
      end if;
    end loop;
    if not v_found then
      return query select false, null::numeric, null::text, ('معيار غير معروف في النموذج: '||v_key)::text; return;
    end if;
  end loop;

  -- 6) إعادة الاحتساب بالعتبة المجمّدة
  v_calc := public.compute_pdf_weighted(p_criteria_scores, v_template, v_pass);

  -- 7) التحديث — لا نلمس pdf_file_path/name ولا حقول محزم ولا الاعتراضات/سير العمل
  update public.evaluations set
    items               = p_criteria_scores,
    section_scores      = p_criteria_scores,
    total_score         = (v_calc->>'total_score')::numeric,
    percentage          = (v_calc->>'percentage')::numeric,
    grade               = v_calc->>'grade',
    status              = v_calc->>'status',
    evaluation_notes    = coalesce(p_evaluation_notes, evaluation_notes),
    pass_score_snapshot = coalesce(pass_score_snapshot, v_pass),
    updated_at          = now()
  where id = p_eval_id;

  -- 8) إشعار الموظف (نمط review_objection)
  insert into public.notifications(id,user_id,title,message,type,entity_type,entity_id,is_read,created_at)
  values((select coalesce(max(id),0)+1 from public.notifications), v_eval.employee_id, 'تم تعديل تقييمك',
    'تم تعديل تقييمك الأسبوعي من قِبَل الإدارة — النتيجة '||(v_calc->>'percentage')||'/100 ('||(v_calc->>'grade')||')',
    case when (v_calc->>'status')='ناجح' then 'success' else 'warning' end, 'evaluation', p_eval_id, false, now());

  -- 9) سجل تدقيق
  select full_name::text into v_actor from public.users where id = v_sess.user_id;
  select full_name::text into v_emp   from public.users where id = v_eval.employee_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
    'admin_update_cg_evaluation','evaluation',p_eval_id,
    'تعديل تقييم CG #'||p_eval_id||' للموظف '||coalesce(v_emp,'-')||' — النتيجة المعاد احتسابها '||(v_calc->>'percentage')||'/100 ('||(v_calc->>'grade')||') عتبة '||v_pass||' — بواسطة '||coalesce(v_actor,'النظام'),
    now());

  return query select true, (v_calc->>'percentage')::numeric, (v_calc->>'grade')::text, 'تم حفظ التعديلات'::text;
end; $function$;

REVOKE ALL ON FUNCTION public.admin_update_cg_evaluation(text,bigint,jsonb,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_cg_evaluation(text,bigint,jsonb,text) TO anon, authenticated;

COMMIT;

-- ============================================================
-- تحقّق بعد التنفيذ:
--   SELECT p.oid::regprocedure, pg_get_function_arguments(p.oid)
--   FROM pg_proc p WHERE p.proname='admin_update_cg_evaluation'
--     AND p.pronamespace='public'::regnamespace;
--   المتوقّع: admin_update_cg_evaluation(text, bigint, jsonb, text)
-- ============================================================
