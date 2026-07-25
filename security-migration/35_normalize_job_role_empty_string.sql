-- =========================================================================
-- 35_normalize_job_role_empty_string.sql
-- م23-د: تطبيع p_job_role (nullif+trim) في update_employee_profile و create_employee
-- =========================================================================
-- السياق: تعديل موظف محزم لا يحفظ job_role. الجسم الحيّ صحيح لقيمة حقيقية
--   (التحقّق يمرّ + coalesce(p_job_role, job_role))، لذا هذا التعديل **دفاعي**:
--   يعامل '' كـ NULL بأمان لو وصلت سلسلة فارغة من العميل.
-- ⚠️ تنبيه: السبب الجذري المرجّح أن العميل يرسل NULL أصلاً (سطر console.log
--   التشخيصي في 04-pages.js يكشفه على أول حفظ). هذا الملف تحصين، والإصلاح
--   الفعلي قد يكون في JS بعد قراءة السطر التشخيصي.
--
-- التعديل الوحيد: استبدال p_job_role بـ nullif(trim(p_job_role),'') في:
--   (1) شرط التحقّق من صلاحية الدور  (2) كتابة job_role (UPDATE/INSERT).
-- بقية الجسم منسوخة حرفياً من النسخة الحيّة. المِنَح محفوظة (CREATE OR REPLACE).
-- تاريخ: 2026-07-25
-- =========================================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) update_employee_profile — الجسم الحيّ + nullif(trim())
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_employee_profile(
  p_session_token text, p_user_id bigint,
  p_full_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text,
  p_employee_number text DEFAULT NULL::text, p_position text DEFAULT NULL::text,
  p_department text DEFAULT NULL::text, p_phone text DEFAULT NULL::text,
  p_supervisor_id bigint DEFAULT NULL::bigint, p_supervisor_name text DEFAULT NULL::text,
  p_department_id bigint DEFAULT NULL::bigint, p_job_role text DEFAULT NULL::text
)
 RETURNS TABLE(ok boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sess record; v_actor text; v_t public.users; v_dept_name text;
  v_allowed constant text[] := array['admin','quality_officer'];
  v_jobs constant text[] := array['real_estate_marketer','designer','social_media','seo','content_manager','quality_agent'];
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if not (v_sess.role = any(v_allowed)) then return query select false,'ليس لديك صلاحية لتعديل الموظف'::text; return; end if;
  select * into v_t from public.users where id=p_user_id;
  if v_t.id is null then return query select false,'المستخدم غير موجود'::text; return; end if;
  -- ★ م23-د: تطبيع p_job_role في التحقّق
  if nullif(trim(p_job_role), '') is not null and not (exists(select 1 from public.evaluation_templates t where t.department_id=p_department_id and t.job_role=nullif(trim(p_job_role), '') and t.is_active)) then return query select false,'الدور الوظيفي غير صالح'::text; return; end if;
  if p_department_id is not null then select name into v_dept_name from public.departments where id=p_department_id; if v_dept_name is null then return query select false,'القسم غير موجود'::text; return; end if; end if;
  if p_email is not null and lower(p_email)<>lower(v_t.email) and exists(select 1 from public.users where lower(email)=lower(p_email) and id<>p_user_id) then
    return query select false,'البريد الإلكتروني مستخدم مسبقاً'::text; return; end if;
  if p_employee_number is not null and p_employee_number<>coalesce(v_t.employee_number,'') and exists(select 1 from public.users where employee_number=p_employee_number and id<>p_user_id) then
    return query select false,'الرقم الوظيفي مستخدم مسبقاً'::text; return; end if;

  update public.users set
    full_name=coalesce(p_full_name,full_name), email=coalesce(p_email,email),
    employee_number=coalesce(p_employee_number,employee_number), position=coalesce(p_position,position),
    department=coalesce(v_dept_name,p_department,department), department_id=coalesce(p_department_id,department_id), job_role=coalesce(nullif(trim(p_job_role), ''),job_role),   -- ★ م23-د
    phone=coalesce(p_phone,phone), supervisor_id=coalesce(p_supervisor_id,supervisor_id), supervisor_name=coalesce(p_supervisor_name,supervisor_name), updated_at=now()
  where id=p_user_id;

  select full_name::text into v_actor from public.users where id=v_sess.user_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs),v_sess.user_id,coalesce(v_actor,'النظام'),v_sess.role,'update_user','user',p_user_id,'تعديل الموظف #'||p_user_id||' — بواسطة '||coalesce(v_actor,'النظام'),now());
  return query select true,'تم حفظ التعديلات'::text;
end; $function$;

-- ------------------------------------------------------------
-- 2) create_employee — الجسم الحيّ + nullif(trim())
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_employee(
  p_session_token text, p_full_name text, p_email text, p_employee_number text,
  p_position text DEFAULT NULL::text, p_department text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text, p_supervisor_id bigint DEFAULT NULL::bigint,
  p_supervisor_name text DEFAULT NULL::text, p_department_id bigint DEFAULT NULL::bigint,
  p_job_role text DEFAULT NULL::text
)
 RETURNS TABLE(ok boolean, user_id bigint, temp_password text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sess record; v_actor text; v_temp text := ''; v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; i int; v_id bigint; v_dept_name text;
  v_allowed constant text[] := array['admin','quality_officer'];
  v_jobs constant text[] := array['real_estate_marketer','designer','social_media','seo','content_manager','quality_agent'];
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,null::bigint,null::text,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if not (v_sess.role = any(v_allowed)) then return query select false,null::bigint,null::text,'ليس لديك صلاحية لإضافة موظف'::text; return; end if;
  if coalesce(trim(p_full_name),'')='' or coalesce(trim(p_email),'')='' or coalesce(trim(p_employee_number),'')='' then return query select false,null::bigint,null::text,'الاسم والبريد والرقم الوظيفي مطلوبة'::text; return; end if;
  if p_department_id is null then return query select false,null::bigint,null::text,'القسم مطلوب للموظف'::text; return; end if;
  select name into v_dept_name from public.departments where id=p_department_id and is_active;
  if v_dept_name is null then return query select false,null::bigint,null::text,'القسم غير موجود أو معطّل'::text; return; end if;
  -- ★ م23-د: تطبيع p_job_role في التحقّق
  if nullif(trim(p_job_role), '') is not null and not (exists(select 1 from public.evaluation_templates t where t.department_id=p_department_id and t.job_role=nullif(trim(p_job_role), '') and t.is_active)) then return query select false,null::bigint,null::text,'الدور الوظيفي غير صالح'::text; return; end if;
  if exists(select 1 from public.users where lower(email)=lower(p_email)) then return query select false,null::bigint,null::text,'البريد الإلكتروني مستخدم مسبقاً'::text; return; end if;
  if exists(select 1 from public.users where lower(username)=lower(p_employee_number) or employee_number=p_employee_number) then return query select false,null::bigint,null::text,'الرقم الوظيفي مستخدم مسبقاً'::text; return; end if;
  for i in 1..10 loop v_temp := v_temp || substr(v_chars,1+floor(random()*length(v_chars))::int,1); end loop;
  v_id := (select coalesce(max(id),0)+1 from public.users);
  insert into public.users(id,username,email,password,full_name,phone,role,department,department_id,job_role,position,employee_number,supervisor_id,supervisor_name,is_active,must_change_password,created_at,updated_at)
  values(v_id,p_employee_number,p_email,extensions.crypt(v_temp, extensions.gen_salt('bf',10)),p_full_name,p_phone,'employee',v_dept_name,p_department_id,nullif(trim(p_job_role), ''),p_position,p_employee_number,p_supervisor_id,coalesce(p_supervisor_name,'-'),true,true,now(),now());   -- ★ م23-د
  select full_name::text into v_actor from public.users where id=v_sess.user_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs),v_sess.user_id,coalesce(v_actor,'النظام'),v_sess.role,'create_user','user',v_id,'إضافة موظف: '||p_full_name||' ('||p_employee_number||') قسم '||v_dept_name||' — بواسطة '||coalesce(v_actor,'النظام'),now());
  return query select true,v_id,v_temp,'تم إضافة الموظف'::text;
end; $function$;

COMMIT;

-- =========================================================================
-- تحقّق بعد التنفيذ:
--   SELECT pg_get_functiondef('public.update_employee_profile(text,bigint,text,text,text,text,text,text,bigint,text,bigint,text)'::regprocedure)
--     LIKE '%nullif(trim(p_job_role)%';   -- متوقّع: true
-- ملاحظة: التوقيعان مطابقان للنسخة الحيّة → CREATE OR REPLACE يستبدل (لا overload جديد)، والمِنَح محفوظة.
-- =========================================================================
