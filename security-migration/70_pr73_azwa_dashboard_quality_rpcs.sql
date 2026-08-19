-- ============================================================================
-- Migration 70 (PR #73) — توسيع لوحة التحكم وتقرير الجودة لقسم عزوة (id=13)
-- ----------------------------------------------------------------------------
-- الأساس: أجسام الإنتاج الحيّة (نسخة حرفية) + تغييرات دنيا لإدراج عزوة.
-- • get_dashboard_stats: array[2,3] → array[2,3,13] · مفتاح القسم بالـcode (لا هارد-كود)
--     (v_dept=3→'cg'، غيره→code: 2→'mahzam'، 13→'azwa') ليطابق DASH_SECTIONS في الفرونت.
-- • get_quality_report: array[2,3] → array[2,3,13] · فرع else يستخدم v_dept (لا =2 صلب) ·
--     key/name للقسم من الجدول (2→محزم، 3→Creative Gene، 13→عزوة).
-- • _dash_section: بلا تعديل — يعالج عزوة عبر فرع else (objections مثل محزم) تلقائياً.
-- سلوك محزم/CG مطابق تماماً (2→mahzam، 3→cg بلا تغيير)؛ التغيير يُضيف عزوة فقط.
-- قراءة فقط (لا كتابة) → صفر مساس بالبيانات. عقد anon-only صريح (REVOKE PUBLIC + GRANT anon).
-- ============================================================================

BEGIN;

-- ========================= get_dashboard_stats =========================
CREATE OR REPLACE FUNCTION public.get_dashboard_stats(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sess record; v_sections jsonb := '{}'::jsonb; v_visible int[]; v_dept int; v_key text;
  v_emp_ids bigint[]; v_recent jsonb; v_full text;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return jsonb_build_object('ok',false,'message','انتهت الجلسة'); end if;
  select full_name::text into v_full from public.users where id=v_sess.user_id;
  if v_sess.role in ('admin','quality_officer') then v_visible := array[2,3,13];   -- ★ PR#73: + عزوة
  else
    select array_agg(distinct u.department_id) into v_visible from public.users u
      where u.department_id in (2,3,13) and ((v_sess.role='supervisor' and (u.supervisor_id=v_sess.user_id or u.id=v_sess.user_id))  -- ★ PR#73: + عزوة
        or (v_sess.role='employee' and u.id=v_sess.user_id));
  end if;
  v_visible := coalesce(v_visible, array[]::int[]);
  foreach v_dept in array v_visible loop
    v_key := case when v_dept=3 then 'cg' else (select code from public.departments where id=v_dept) end;  -- ★ PR#73: مفتاح بالـcode (2→mahzam، 13→azwa)
    select array_agg(u.id) into v_emp_ids from public.users u
      where u.department_id=v_dept and u.role='employee'
        and (v_sess.role in ('admin','quality_officer') or (v_sess.role='supervisor' and u.supervisor_id=v_sess.user_id) or (v_sess.role='employee' and u.id=v_sess.user_id));
    v_sections := v_sections || jsonb_build_object(v_key, public._dash_section(v_dept, coalesce(v_emp_ids, array[]::bigint[])));
  end loop;
  if v_sess.role in ('admin','quality_officer') then
    select coalesce(jsonb_agg(x order by ts desc),'[]'::jsonb) into v_recent from (
      select jsonb_build_object('action',action,'details',details,'user_name',user_name,'at',"timestamp",'entity_type',entity_type) x, "timestamp" ts
      from public.audit_logs order by "timestamp" desc limit 10) s;
  else
    select coalesce(jsonb_agg(x order by ts desc),'[]'::jsonb) into v_recent from (
      select jsonb_build_object('action',action,'details',details,'user_name',user_name,'at',"timestamp",'entity_type',entity_type) x, "timestamp" ts
      from public.audit_logs where user_id=v_sess.user_id order by "timestamp" desc limit 10) s;
  end if;
  return jsonb_build_object('ok',true,'role',v_sess.role,'full_name',v_full,'user_id',v_sess.user_id,'sections',v_sections,'recent',v_recent);
end; $function$;

REVOKE ALL ON FUNCTION public.get_dashboard_stats(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(text) TO anon, authenticated;

-- ========================= get_quality_report =========================
CREATE OR REPLACE FUNCTION public.get_quality_report(p_session_token text, p_from_date date, p_to_date date, p_department_id bigint DEFAULT NULL::bigint, p_quality_user_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sess record; v_from date; v_to date; v_depts int[]; v_dept int; v_ps int;
  v_total int; v_pass int; v_fail int; v_avg numeric; v_obj int; v_rate numeric;
  v_sections jsonb := '[]'::jsonb; v_rates numeric[] := array[]::numeric[]; v_overall numeric; v_officers jsonb; v_line jsonb;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return jsonb_build_object('ok',false,'message','انتهت الجلسة'); end if;
  if v_sess.role not in ('admin','quality_officer') then return jsonb_build_object('ok',false,'message','تقرير الجودة للمدير أو الجودة فقط'); end if;
  v_from := coalesce(p_from_date, (now()::date - interval '3 months')::date);
  v_to := coalesce(p_to_date, now()::date);
  if p_department_id is null then v_depts := array[2,3,13]; else v_depts := array[p_department_id::int]; end if;  -- ★ PR#73: + عزوة

  foreach v_dept in array v_depts loop
    select coalesce(pass_score,80) into v_ps from public.departments where id=v_dept;
    select count(*), count(*) filter (where e.percentage>=v_ps), count(*) filter (where e.percentage<v_ps), coalesce(round(avg(e.percentage),1),0)
      into v_total, v_pass, v_fail, v_avg
      from public.evaluations e join public.users u on u.id=e.employee_id
      where u.department_id=v_dept and e.evaluation_date between v_from and v_to and (p_quality_user_id is null or e.evaluator_id=p_quality_user_id);
    if v_dept=3 then
      select count(*) into v_obj from public.creative_gene_objections o join public.evaluations e on e.id=o.evaluation_id join public.users u on u.id=e.employee_id
        where u.department_id=3 and e.evaluation_date between v_from and v_to and (p_quality_user_id is null or e.evaluator_id=p_quality_user_id);
    else
      select count(*) into v_obj from public.objections o join public.evaluations e on e.id=o.evaluation_id join public.users u on u.id=e.employee_id
        where u.department_id=v_dept and e.evaluation_date between v_from and v_to and (p_quality_user_id is null or e.evaluator_id=p_quality_user_id);  -- ★ PR#73: v_dept (كان =2 صلب)
    end if;
    v_rate := case when v_total>0 then round(v_pass::numeric/v_total*100,1) else 0 end;
    v_rates := v_rates || v_rate;
    v_sections := v_sections || jsonb_build_object(
      'key',  case v_dept when 2 then 'mahzam' when 3 then 'cg' else (select code from public.departments where id=v_dept) end,       -- ★ PR#73: 13→azwa
      'name', case v_dept when 2 then 'محزم' when 3 then 'Creative Gene' else (select name from public.departments where id=v_dept) end, -- ★ PR#73: 13→عزوة
      'pass_score',v_ps,'total',v_total,'pass',v_pass,'fail',v_fail,'avg',v_avg,'objections',v_obj,'pass_rate',v_rate);
  end loop;
  select round(avg(x),1) into v_overall from unnest(v_rates) x; v_overall := coalesce(v_overall,0);

  select coalesce(jsonb_agg(jsonb_build_object('name',nm,'total',tot,'mahzam',mz,'cg',cg,'objections',objn,
     'accepted_rate', case when objn>0 then round(acc::numeric/objn*100,1) else 0 end,'avg_score',avgs) order by tot desc),'[]'::jsonb)
   into v_officers from (
    select q.full_name nm,
      (select count(*) from public.evaluations e join public.users u on u.id=e.employee_id where e.evaluator_id=q.id and e.evaluation_date between v_from and v_to and u.department_id = any(v_depts)) tot,
      (select count(*) from public.evaluations e join public.users u on u.id=e.employee_id where e.evaluator_id=q.id and e.evaluation_date between v_from and v_to and u.department_id=2 and 2 = any(v_depts)) mz,
      (select count(*) from public.evaluations e join public.users u on u.id=e.employee_id where e.evaluator_id=q.id and e.evaluation_date between v_from and v_to and u.department_id=3 and 3 = any(v_depts)) cg,
      (select coalesce(round(avg(e.percentage),1),0) from public.evaluations e join public.users u on u.id=e.employee_id where e.evaluator_id=q.id and e.evaluation_date between v_from and v_to and u.department_id = any(v_depts)) avgs,
      (select count(*) from public.creative_gene_objections o join public.evaluations e on e.id=o.evaluation_id where e.evaluator_id=q.id and e.evaluation_date between v_from and v_to)
       + (select count(*) from public.objections o join public.evaluations e on e.id=o.evaluation_id where e.evaluator_id=q.id and e.evaluation_date between v_from and v_to) objn,
      (select count(*) from public.creative_gene_objections o join public.evaluations e on e.id=o.evaluation_id where e.evaluator_id=q.id and o.status in ('accepted','partial') and e.evaluation_date between v_from and v_to)
       + (select count(*) from public.objections o join public.evaluations e on e.id=o.evaluation_id where e.evaluator_id=q.id and o.status='accepted' and e.evaluation_date between v_from and v_to) acc
    from public.users q where q.role='quality_officer' and (p_quality_user_id is null or q.id=p_quality_user_id)
   ) t;

  select coalesce(jsonb_agg(jsonb_build_object('week',wk,'rate',rate) order by ord),'[]'::jsonb) into v_line from (
    select to_char(date_trunc('week',e.evaluation_date),'MM-DD') wk, date_trunc('week',e.evaluation_date) ord,
      round(count(*) filter (where e.percentage >= coalesce(d.pass_score,80))::numeric / nullif(count(*),0) * 100,1) rate
    from public.evaluations e join public.users u on u.id=e.employee_id join public.departments d on d.id=u.department_id
    where u.department_id = any(v_depts) and e.evaluation_date > (v_to - interval '6 weeks') and e.evaluation_date <= v_to
      and (p_quality_user_id is null or e.evaluator_id=p_quality_user_id)
    group by date_trunc('week',e.evaluation_date)) s;

  return jsonb_build_object('ok',true,'from',v_from,'to',v_to,'overall',v_overall,'sections',v_sections,'officers',v_officers,'line',v_line);
end; $function$;

REVOKE ALL ON FUNCTION public.get_quality_report(text,date,date,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_quality_report(text,date,date,bigint,bigint) TO anon, authenticated;

-- ملاحظة: _dash_section(integer,bigint[]) بلا تعديل — فرع else (p_dept<>3) يستخدم objections، فينطبق على عزوة (13) تلقائياً.

-- ========================= تحقّق ذاتي =========================
DO $$
DECLARE s1 text := 'public.get_dashboard_stats(text)';
        s2 text := 'public.get_quality_report(text,date,date,bigint,bigint)';
BEGIN
  IF has_function_privilege('public', s1, 'EXECUTE') THEN RAISE EXCEPTION 'M70 فشل — PUBLIC ما زال ينفّذ get_dashboard_stats'; END IF;
  IF has_function_privilege('public', s2, 'EXECUTE') THEN RAISE EXCEPTION 'M70 فشل — PUBLIC ما زال ينفّذ get_quality_report'; END IF;
  IF NOT has_function_privilege('anon', s1, 'EXECUTE') THEN RAISE EXCEPTION 'M70 فشل — anon لا ينفّذ get_dashboard_stats'; END IF;
  IF NOT has_function_privilege('anon', s2, 'EXECUTE') THEN RAISE EXCEPTION 'M70 فشل — anon لا ينفّذ get_quality_report'; END IF;
  -- تأكيد إدراج عزوة (array 2,3,13) في الجسمين
  IF position('2,3,13' in pg_get_functiondef(s1::regprocedure)) = 0 THEN RAISE EXCEPTION 'M70 — get_dashboard_stats لا يحوي 2,3,13'; END IF;
  IF position('2,3,13' in pg_get_functiondef(s2::regprocedure)) = 0 THEN RAISE EXCEPTION 'M70 — get_quality_report لا يحوي 2,3,13'; END IF;
  RAISE NOTICE 'Migration 70 OK — لوحة التحكم وتقرير الجودة يشملان عزوة (id=13) · anon-only محفوظ · _dash_section بلا تعديل';
END $$;

COMMIT;

-- Rollback: أعِد جسمَي get_dashboard_stats/get_quality_report الأصليين (array[2,3]).
