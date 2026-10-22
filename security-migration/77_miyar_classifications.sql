-- Additive Miyar reporting; preserve records, numeric scoring, session checks and existing grants.
begin;
CREATE OR REPLACE FUNCTION public._dash_section(p_dept integer, p_emp_ids bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_month_start date := date_trunc('month', now())::date; v_ps int;
  v_total int; v_month int; v_pass int; v_fail int; v_avg numeric;
  v_active int; v_obj_open int; v_obj_closed int; v_pending int;
  v_miyar jsonb; v_notes jsonb; v_trend jsonb; v_top jsonb;
begin
  select coalesce(pass_score,80) into v_ps from public.departments where id=p_dept;
  v_ps := coalesce(v_ps,80);
  select count(*), count(*) filter (where e.evaluation_date >= v_month_start),
         count(*) filter (where e.percentage >= v_ps), count(*) filter (where e.percentage < v_ps),
         coalesce(round(avg(e.percentage),1),0)
    into v_total, v_month, v_pass, v_fail, v_avg
    from public.evaluations e where e.employee_id = any(p_emp_ids);
  select count(*) into v_active from public.users where id = any(p_emp_ids) and is_active;
  if p_dept = 3 then
    select count(*) filter (where status='pending'), count(*) filter (where status<>'pending')
      into v_obj_open, v_obj_closed from public.creative_gene_objections where employee_id = any(p_emp_ids);
    select count(*) into v_pending from public.creative_gene_weekly_status
      where employee_id = any(p_emp_ids) and workflow_state in ('pending_quality','pending_supervisor');
    select coalesce(jsonb_agg(jsonb_build_object('note',note,'count',c) order by c desc),'[]'::jsonb) into v_notes from (
      select nullif(trim(e.evaluation_notes),'') note, count(*) c from public.evaluations e
      where e.employee_id=any(p_emp_ids) and nullif(trim(e.evaluation_notes),'') is not null group by 1 order by c desc limit 5) s;
  else
    select count(*) filter (where status in ('pending','under_review')), count(*) filter (where status not in ('pending','under_review'))
      into v_obj_open, v_obj_closed from public.objections where employee_id = any(p_emp_ids);
    v_pending := 0;
    select coalesce(jsonb_agg(jsonb_build_object('note',note,'count',c) order by c desc),'[]'::jsonb) into v_notes from (
      select e.observed_issue note, count(*) c from public.evaluations e
      where e.employee_id=any(p_emp_ids) and e.observed_issue is not null and e.observed_issue not in ('لا يوجد ملاحظات','') group by 1 order by c desc limit 5) s;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('week',wk,'avg',a) order by ord),'[]'::jsonb) into v_trend from (
    select to_char(date_trunc('week', e.evaluation_date),'MM-DD') wk, round(avg(e.percentage),1) a, date_trunc('week', e.evaluation_date) ord
    from public.evaluations e where e.employee_id=any(p_emp_ids) and e.evaluation_date >= (now()::date - interval '6 weeks')
    group by date_trunc('week', e.evaluation_date)) s;
  select coalesce(jsonb_agg(jsonb_build_object('name',nm,'count',c) order by c desc),'[]'::jsonb) into v_top from (
    select u.full_name nm, count(*) c from public.evaluations e join public.users u on u.id=e.employee_id
    where e.employee_id=any(p_emp_ids) group by u.full_name order by count(*) desc limit 5) s;
 select jsonb_build_object(
 'below',count(*) filter(where e.percentage>=0 and e.percentage<80),
 'near',count(*) filter(where e.percentage>=80 and e.percentage<90),
 'meets',count(*) filter(where e.percentage>=90 and e.percentage<100),
 'excellent',count(*) filter(where e.percentage=100),
 'review',count(*) filter(where e.percentage is null or e.percentage<0 or e.percentage>100)) into v_miyar
 from public.evaluations e where e.employee_id = any(p_emp_ids);
 return jsonb_build_object('miyar_counts',v_miyar,'total',coalesce(v_total,0),'month',coalesce(v_month,0),'pass',coalesce(v_pass,0),'fail',coalesce(v_fail,0),
    'avg',coalesce(v_avg,0),'active_employees',coalesce(v_active,0),'objections_open',coalesce(v_obj_open,0),
    'objections_closed',coalesce(v_obj_closed,0),'pending',coalesce(v_pending,0),'pass_score',v_ps,'notes',v_notes,'trend',v_trend,'top',v_top);
end; $function$;

CREATE OR REPLACE FUNCTION public.get_quality_report(p_session_token text, p_from_date date, p_to_date date, p_department_id bigint DEFAULT NULL::bigint, p_quality_user_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sess record; v_from date; v_to date; v_depts int[]; v_dept int; v_ps int;
  v_total int; v_pass int; v_fail int; v_avg numeric; v_obj int; v_rate numeric;
  v_miyar jsonb; v_miyar_rates numeric[] := array[]::numeric[]; v_miyar_rate numeric; v_miyar_overall numeric;
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
   select jsonb_build_object(
 'below',count(*) filter(where e.percentage>=0 and e.percentage<80),
 'near',count(*) filter(where e.percentage>=80 and e.percentage<90),
 'meets',count(*) filter(where e.percentage>=90 and e.percentage<100),
 'excellent',count(*) filter(where e.percentage=100),
 'review',count(*) filter(where e.percentage is null or e.percentage<0 or e.percentage>100)) into v_miyar
 from public.evaluations e join public.users u on u.id=e.employee_id where u.department_id=v_dept and e.evaluation_date between v_from and v_to and (p_quality_user_id is null or e.evaluator_id=p_quality_user_id);
 v_miyar_rate := case when v_total>0 then round(((v_miyar->>'meets')::numeric+(v_miyar->>'excellent')::numeric)/v_total*100,1) else 0 end;
 v_miyar_rates := v_miyar_rates || v_miyar_rate;
 v_rate := case when v_total>0 then round(v_pass::numeric/v_total*100,1) else 0 end;
    v_rates := v_rates || v_rate;
    v_sections := v_sections || jsonb_build_object(
      'key',  case v_dept when 2 then 'mahzam' when 3 then 'cg' else (select code from public.departments where id=v_dept) end,       -- ★ PR#73: 13→azwa
      'name', case v_dept when 2 then 'محزم' when 3 then 'Creative Gene' else (select name from public.departments where id=v_dept) end, -- ★ PR#73: 13→عزوة
      'miyar_counts',v_miyar,'conformance_rate',v_miyar_rate,'pass_score',v_ps,'total',v_total,'pass',v_pass,'fail',v_fail,'avg',v_avg,'objections',v_obj,'pass_rate',v_rate);
  end loop;
  select coalesce(round(avg(x),1),0) into v_miyar_overall from unnest(v_miyar_rates) x;
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

  select coalesce(jsonb_agg(jsonb_build_object('week',wk,'rate',rate,'conformance_rate',miyar_rate) order by ord),'[]'::jsonb) into v_line from (
    select to_char(date_trunc('week',e.evaluation_date),'MM-DD') wk, date_trunc('week',e.evaluation_date) ord,
      round(count(*) filter(where e.percentage>=90 and e.percentage<=100)::numeric/nullif(count(*),0)*100,1) miyar_rate,
 round(count(*) filter (where e.percentage >= coalesce(d.pass_score,80))::numeric / nullif(count(*),0) * 100,1) rate
    from public.evaluations e join public.users u on u.id=e.employee_id join public.departments d on d.id=u.department_id
    where u.department_id = any(v_depts) and e.evaluation_date > (v_to - interval '6 weeks') and e.evaluation_date <= v_to
      and (p_quality_user_id is null or e.evaluator_id=p_quality_user_id)
    group by date_trunc('week',e.evaluation_date)) s;

  return jsonb_build_object('ok',true,'from',v_from,'to',v_to,'overall',v_overall,'conformance_rate',v_miyar_overall,'sections',v_sections,'officers',v_officers,'line',v_line);
end; $function$;
commit;
