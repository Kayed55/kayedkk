-- =========================================================================
-- 49_create_weekly_evaluation_template_id.sql  (Phase 2b — اختيار القالب عبر template_id)
--
-- create_weekly_evaluation يختار القالب عبر users.template_id أولاً (يشتقّ v_job منه
-- لـ compute_task_based/role_kpis)، ثم fallback (dept, job_role) للقديم، ثم RAISE للقيادات.
--
-- CREATE OR REPLACE (لا DROP): التوقيع لا يتغيّر (template_id من users، ليس معاملاً) →
--   لا لبس overload، والمنح محفوظة. REVOKE/GRANT صريحان دفاعياً (نمط 45) + DO guard.
-- المتن حرفي من ملف 45 (matches_repo=true مؤكّد: live == 45) عدا: v_tid + كتلة الاختيار.
-- يحفظ حرفياً: ★#8 (فلترة الدور، الآن في fallback) + ★#33-parallel (تطبيع week_start).
-- لا مساس بـ compute_task_based. المرجع: #38. التاريخ: 2026-08-02.
-- =========================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.create_weekly_evaluation(p_session_token text, p_employee_id bigint, p_week_start date DEFAULT NULL::date, p_week_end date DEFAULT NULL::date, p_tasks jsonb DEFAULT '[]'::jsonb, p_kpis jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(ok boolean, evaluation_id bigint, percentage numeric, grade text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sess record; v_dept bigint; v_job text; v_template jsonb; v_ver int; v_type text; v_scores jsonb; v_id bigint; v_ws date; v_we date; v_emp text; v_actor text;
  v_tid bigint;  -- ★ Phase 2b: النموذج المرتبط بالموظف (users.template_id)
  v_allowed constant text[] := array['admin','quality_officer'];
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,null::bigint,null::numeric,null::text,'انتهت الجلسة'::text; return; end if;
  if not (v_sess.role = any(v_allowed)) then return query select false,null::bigint,null::numeric,null::text,'ليس لديك صلاحية'::text; return; end if;
  if p_employee_id is null then return query select false,null::bigint,null::numeric,null::text,'الموظف مطلوب'::text; return; end if;
  select department_id, job_role, template_id into v_dept, v_job, v_tid from public.users where id=p_employee_id;
  if v_dept is null then return query select false,null::bigint,null::numeric,null::text,'الموظف غير مرتبط بقسم'::text; return; end if;
  -- ★ Phase 2b: اختيار القالب عبر users.template_id أولاً (يشتقّ v_job منه)
  if v_tid is not null then
    select template_jsonb, version, template_type, job_role into v_template, v_ver, v_type, v_job from public.evaluation_templates where id=v_tid and is_active;
  end if;
  -- fallback (dept, job_role) — منطق ★#8 (للقديم/غير المربوط)
  if v_template is null then
    select template_jsonb, version, template_type into v_template, v_ver, v_type from public.evaluation_templates where department_id=v_dept and is_active
      and (job_role = v_job or job_role is null)   -- ★ #8 فلترة الدور
    order by (job_role is not null) desc           -- ★ #8 مطابق-الدور أولاً، ثم افتراضي القسم
    limit 1;
  end if;
  if v_template is null then raise exception 'موظّف بلا نموذج تقييم — يرجى ربط نموذج قبل إنشاء التقييم'; end if;  -- ★ Phase 2b معالجة القيادات/غير المربوط
  if v_type <> 'task_based_weekly' then return query select false,null::bigint,null::numeric,null::text,'قسم هذا الموظف ليس من نوع التقييم الأسبوعي'::text; return; end if;
  v_ws := coalesce(p_week_start, public.week_start_saturday());
  v_ws := v_ws - ((extract(dow from v_ws)::int + 1) % 7);   -- ★ #33-parallel تطبيع دفاعي إلى سبت الأسبوع
  v_we := v_ws + 6;                                          -- ★ #33-parallel (كان: coalesce(p_week_end, v_ws + 6))
  v_scores := public.compute_task_based(p_tasks, p_kpis, v_job, v_template);

  v_id := (select coalesce(max(id),0)+1 from public.evaluations);
  insert into public.evaluations(id,employee_id,evaluator_id,evaluation_date,items,section_scores,total_score,percentage,grade,status,approved,tasks,role_kpis_values,week_start,week_end,template_snapshot,template_version,template_type,created_at,updated_at)
  values(v_id,p_employee_id,v_sess.user_id,v_we,'{}'::jsonb,v_scores,(v_scores->>'total_score')::numeric,(v_scores->>'percentage')::numeric,v_scores->>'grade',v_scores->>'status',false,p_tasks,p_kpis,v_ws,v_we,v_template,v_ver,'task_based_weekly',now(),now());
  insert into public.notifications(id,user_id,title,message,type,entity_type,entity_id,is_read,created_at)
  values((select coalesce(max(id),0)+1 from public.notifications),p_employee_id,'تقييم أسبوعي جديد','نتيجة أسبوعك '||(v_scores->>'percentage')||'% ('||(v_scores->>'grade')||')',case when (v_scores->>'status')='ناجح' then 'success' else 'warning' end,'evaluation',v_id,false,now());
  select full_name::text into v_actor from public.users where id=v_sess.user_id;
  select full_name::text into v_emp from public.users where id=p_employee_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs),v_sess.user_id,coalesce(v_actor,'النظام'),v_sess.role,'create_evaluation','evaluation',v_id,'تقييم أسبوعي #'||v_id||' للموظف '||coalesce(v_emp,'-')||' - '||(v_scores->>'percentage')||'%',now());
  return query select true,v_id,(v_scores->>'percentage')::numeric,(v_scores->>'grade')::text,'تم إنشاء التقييم الأسبوعي'::text;
end; $function$;

-- المنح (صريحة دفاعياً — نمط 45؛ CREATE OR REPLACE يحفظها أصلاً)
REVOKE ALL ON FUNCTION public.create_weekly_evaluation(text,bigint,date,date,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_weekly_evaluation(text,bigint,date,date,jsonb,jsonb) TO anon, authenticated;

-- حارس تحقّق قبل COMMIT
DO $$
BEGIN
  IF has_function_privilege('public', 'public.create_weekly_evaluation(text,bigint,date,date,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'GRANT check failed: create_weekly_evaluation يجب ألّا تكون قابلة للتنفيذ من PUBLIC';
  END IF;
  RAISE NOTICE '✅ SQL 49: create_weekly_evaluation public EXECUTE = false';
END $$;

COMMIT;
