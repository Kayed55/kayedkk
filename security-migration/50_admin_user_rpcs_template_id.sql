-- =========================================================================
-- 50_admin_user_rpcs_template_id.sql  (#46b — دعم template_id في مسار usr form)
--
-- إضافة p_template_id لـ admin_create_user + admin_update_user واشتقاق job_role منه
-- (نمط SQL 47). + إصلاحان أمني/منطقي مكتشفان:
--   (1) الدالتان كانتا CREATE OR REPLACE بلا REVOKE → PUBLIC EXECUTE (ثغرة) → نضيف REVOKE/GRANT.
--   (2) admin_update_user: فحص job_role كان يستخدم p_department_id مباشرة → يكسر عند تعديل
--       الدور بلا تغيير القسم (p_department_id=NULL). الإصلاح: coalesce(p_department_id, v_target.department_id).
--
-- DROP+CREATE (لا CREATE OR REPLACE): إضافة معامل تُغيّر التوقيع → لبس overload (كـ47).
-- المتنان حرفيان من الحيّ (SRC5/SRC6) عدا المواضع المُعلَّمة ★#46b.
-- ملاحظة: RAISE عند p_template_id غير صالح في create+update (سلامة: تفادي تخزين template_id
--   غير صالح مع job_role غير متّسق — يطابق SQL 47، بدل coalesce الصامت).
-- المرجع: #38 / #46b. التاريخ: 2026-08-02.
-- =========================================================================
BEGIN;

-- =========================================================================
-- 1) admin_create_user
-- =========================================================================
DROP FUNCTION IF EXISTS public.admin_create_user(text,text,text,text,text,text,text,text,text,bigint,date,text,bigint,text);

CREATE OR REPLACE FUNCTION public.admin_create_user(p_session_token text, p_full_name text, p_email text, p_username text, p_role text, p_department text DEFAULT NULL::text, p_position text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_employee_number text DEFAULT NULL::text, p_supervisor_id bigint DEFAULT NULL::bigint, p_hire_date date DEFAULT NULL::date, p_notes text DEFAULT NULL::text, p_department_id bigint DEFAULT NULL::bigint, p_job_role text DEFAULT NULL::text, p_template_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(ok boolean, user_id bigint, temp_password text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sess record; v_actor text; v_allowed constant text[] := array['admin','quality_officer','supervisor','employee'];
  v_jobs constant text[] := array['real_estate_marketer','designer','social_media','seo','content_manager','quality_agent'];
  v_temp text := ''; v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; i int; v_id bigint; v_dept_name text;
  v_final_job_role text;  -- ★ #46b: الدور المُشتقّ من النموذج إن مُرّر p_template_id
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,null::bigint,null::text,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if v_sess.role not in ('admin','quality_officer') then return query select false,null::bigint,null::text,'ليس لديك صلاحية لإضافة مستخدم'::text; return; end if;
  if v_sess.role='quality_officer' and p_role='admin' then return query select false,null::bigint,null::text,'موظف الجودة لا يستطيع إنشاء مستخدم بدور المدير'::text; return; end if;
  if coalesce(trim(p_full_name),'')='' or coalesce(trim(p_email),'')='' or coalesce(trim(p_username),'')='' then return query select false,null::bigint,null::text,'الاسم والبريد واسم المستخدم مطلوبة'::text; return; end if;
  if not (p_role = any(v_allowed)) then return query select false,null::bigint,null::text,'دور غير صالح'::text; return; end if;
  if p_role='employee' and p_department_id is null then return query select false,null::bigint,null::text,'القسم مطلوب للموظف'::text; return; end if;
  if p_department_id is not null then select name into v_dept_name from public.departments where id=p_department_id; if v_dept_name is null then return query select false,null::bigint,null::text,'القسم غير موجود'::text; return; end if; end if;
  if p_job_role is not null and not (exists(select 1 from public.evaluation_templates t where t.department_id=p_department_id and t.job_role=p_job_role and t.is_active)) then return query select false,null::bigint,null::text,'الدور الوظيفي غير صالح'::text; return; end if;
  -- ★ #46b: اشتقاق job_role من النموذج المرتبط (إن مُرّر p_template_id) — يتجاوز p_job_role
  v_final_job_role := p_job_role;
  if p_template_id is not null then
    select job_role into v_final_job_role from public.evaluation_templates where id=p_template_id and department_id=p_department_id and is_active;
    if not found then raise exception 'النموذج غير موجود أو لا ينتمي للقسم'; end if;
  end if;
  if exists(select 1 from public.users where lower(email)=lower(p_email)) then return query select false,null::bigint,null::text,'البريد الإلكتروني مستخدم مسبقاً'::text; return; end if;
  if exists(select 1 from public.users where lower(username)=lower(p_username)) then return query select false,null::bigint,null::text,'اسم المستخدم مستخدم مسبقاً'::text; return; end if;
  for i in 1..10 loop v_temp := v_temp || substr(v_chars,1+floor(random()*length(v_chars))::int,1); end loop;
  v_id := (select coalesce(max(id),0)+1 from public.users);
  insert into public.users(id,username,email,password,full_name,phone,role,department,department_id,job_role,position,employee_number,supervisor_id,is_active,must_change_password,hire_date,notes,template_id,created_at,updated_at)
  values (v_id,p_username,p_email,extensions.crypt(v_temp, extensions.gen_salt('bf',10)),p_full_name,p_phone,p_role,coalesce(v_dept_name,p_department),p_department_id,v_final_job_role,p_position,p_employee_number,p_supervisor_id,true,true,p_hire_date,p_notes,p_template_id,now(),now());
  select full_name::text into v_actor from public.users where id=v_sess.user_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs),v_sess.user_id,coalesce(v_actor,'النظام'),v_sess.role,'create_user','user',v_id,'إنشاء مستخدم: '||p_full_name||' ('||p_role||') — بواسطة '||coalesce(v_actor,'النظام'),now());
  return query select true,v_id,v_temp,'تم إنشاء المستخدم'::text;
end; $function$;

REVOKE ALL ON FUNCTION public.admin_create_user(text,text,text,text,text,text,text,text,text,bigint,date,text,bigint,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_user(text,text,text,text,text,text,text,text,text,bigint,date,text,bigint,text,bigint) TO anon, authenticated;

-- =========================================================================
-- 2) admin_update_user
-- =========================================================================
DROP FUNCTION IF EXISTS public.admin_update_user(text,bigint,text,text,text,text,text,text,text,bigint,date,text,bigint,text);

CREATE OR REPLACE FUNCTION public.admin_update_user(p_session_token text, p_user_id bigint, p_full_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_role text DEFAULT NULL::text, p_department text DEFAULT NULL::text, p_position text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_employee_number text DEFAULT NULL::text, p_supervisor_id bigint DEFAULT NULL::bigint, p_hire_date date DEFAULT NULL::date, p_notes text DEFAULT NULL::text, p_department_id bigint DEFAULT NULL::bigint, p_job_role text DEFAULT NULL::text, p_template_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(ok boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sess record; v_actor text; v_target public.users;
  v_allowed constant text[] := array['admin','quality_officer','supervisor','employee'];
  v_jobs constant text[] := array['real_estate_marketer','designer','social_media','seo','content_manager','quality_agent'];
  v_final_job_role text;  -- ★ #46b: الدور المُشتقّ من النموذج إن مُرّر p_template_id
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false, 'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if v_sess.role not in ('admin','quality_officer') then return query select false, 'ليس لديك صلاحية'::text; return; end if;
  select * into v_target from public.users where id = p_user_id;
  if v_target.id is null then return query select false, 'المستخدم غير موجود'::text; return; end if;
  if v_sess.role='quality_officer' and (v_target.role='admin' or coalesce(p_role,'')='admin') then return query select false, 'موظف الجودة لا يمكنه تعديل حسابات المدير أو تعيين دور المدير'::text; return; end if;
  if p_role is not null and p_role <> v_target.role then
    if p_user_id = v_sess.user_id then return query select false, 'لا يمكنك تغيير دور حسابك'::text; return; end if;
    if not (p_role = any(v_allowed)) then return query select false, 'دور غير صالح'::text; return; end if;
  end if;
  -- ★ #46b: القسم الفعّال = المُمرَّر أو الحالي (يُصلح باغ الفحص عند p_department_id=NULL)
  if p_job_role is not null and not (exists(select 1 from public.evaluation_templates t where t.department_id=coalesce(p_department_id, v_target.department_id) and t.job_role=p_job_role and t.is_active)) then return query select false, 'الدور الوظيفي غير صالح'::text; return; end if;
  if p_department_id is not null and not exists(select 1 from public.departments where id=p_department_id) then return query select false, 'القسم غير موجود'::text; return; end if;
  -- ★ #46b: اشتقاق job_role من النموذج المرتبط (إن مُرّر p_template_id) — القسم الفعّال (جديد أو حالي)
  if p_template_id is not null then
    select job_role into v_final_job_role from public.evaluation_templates where id=p_template_id and department_id=coalesce(p_department_id, v_target.department_id) and is_active;
    if not found then raise exception 'النموذج غير موجود أو لا ينتمي للقسم'; end if;
  end if;
  if p_email is not null and lower(p_email) <> lower(v_target.email) and exists(select 1 from public.users where lower(email)=lower(p_email) and id<>p_user_id) then
    return query select false, 'البريد الإلكتروني مستخدم مسبقاً'::text; return; end if;
  update public.users set
    full_name=coalesce(p_full_name, full_name), email=coalesce(p_email, email), role=coalesce(p_role, role),
    department=coalesce(p_department, department), department_id=coalesce(p_department_id, department_id), job_role=coalesce(v_final_job_role, p_job_role, job_role), template_id=coalesce(p_template_id, template_id),
    position=coalesce(p_position, position), phone=coalesce(p_phone, phone), employee_number=coalesce(p_employee_number, employee_number),
    supervisor_id=coalesce(p_supervisor_id, supervisor_id), hire_date=coalesce(p_hire_date, hire_date), notes=coalesce(p_notes, notes), updated_at=now()
  where id = p_user_id;
  select full_name::text into v_actor from public.users where id = v_sess.user_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,'update_user','user',p_user_id,'تعديل المستخدم #'||p_user_id||' — بواسطة '||coalesce(v_actor,'النظام'),now());
  return query select true, 'تم تحديث بيانات المستخدم'::text;
end; $function$;

REVOKE ALL ON FUNCTION public.admin_update_user(text,bigint,text,text,text,text,text,text,text,bigint,date,text,bigint,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_user(text,bigint,text,text,text,text,text,text,text,bigint,date,text,bigint,text,bigint) TO anon, authenticated;

-- =========================================================================
-- 3) Backfill idempotent — يملأ template_id الفارغ من (dept, job_role) (القيادة dept=NULL تبقى NULL)
--    متوقّع: 0 صفوف (null_with_dept=0 من CSV 94) — guard دفاعي لأي موظف usr مستقبلي/سابق.
-- =========================================================================
UPDATE public.users u SET template_id = t.id
FROM public.evaluation_templates t
WHERE t.department_id = u.department_id AND t.is_active
  AND (t.job_role = u.job_role OR (t.job_role IS NULL AND u.job_role IS NULL))
  AND u.is_active AND u.template_id IS NULL;

-- =========================================================================
-- 4) حارس تحقّق قبل COMMIT — يُجهض الـtx عند أي انحدار صلاحيات أو غياب المعامل
-- =========================================================================
DO $$
BEGIN
  IF has_function_privilege('public', 'public.admin_create_user(text,text,text,text,text,text,text,text,text,bigint,date,text,bigint,text,bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'GRANT check failed: admin_create_user يجب ألّا تكون قابلة للتنفيذ من PUBLIC';
  END IF;
  IF has_function_privilege('public', 'public.admin_update_user(text,bigint,text,text,text,text,text,text,text,bigint,date,text,bigint,text,bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'GRANT check failed: admin_update_user يجب ألّا تكون قابلة للتنفيذ من PUBLIC';
  END IF;
  RAISE NOTICE '✅ SQL 50: admin_create_user + admin_update_user — public EXECUTE=false، p_template_id مُضاف';
END $$;

COMMIT;
