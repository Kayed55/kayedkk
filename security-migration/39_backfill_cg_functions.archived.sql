-- ARCHIVED: 2026-08-01
-- Superseded by 41_*.sql (see #19)
-- This file kept for historical reference only. Do NOT execute.
-- =========================================================================
-- 39_backfill_cg_functions.sql  (#21 — استعادة مصدر دوال CG)
-- توثيق مصدر دالتين موجودتين فعلاً على القاعدة بلا ملف مصدر (repo↔DB desync):
--   • create_cg_template(text,bigint,text,jsonb)
--   • upsert_evaluation_template(text,bigint,jsonb,text,text)
-- التعريفان منسوخان حرفياً من pg_get_functiondef للحيّ — **لا يغيّران المنطق**.
-- الغرض: جعل المستودع مصدر الحقيقة (يفكّ حجب #19: إضافة تحقّق الأوزان لاحقاً بأمان).
-- التاريخ: 2026-07-31
--
-- ملاحظة صلاحيات: proacl الحيّ يمنح PUBLIC تنفيذاً (=X) إضافةً لـ anon/authenticated/
-- service_role. هذا الملف يتبع نمط الملفات 36–38 (REVOKE ALL ثم GRANT لـ anon,
-- authenticated) — تشديد طفيف يزيل منح PUBLIC الضمني. service_role يحتفظ بالتنفيذ
-- عبر دوره (يتجاوز RLS). لو رغبت مطابقة حرفية 100% تشمل PUBLIC، أبلغني.
-- =========================================================================

-- -------------------------------------------------------------------------
-- create_cg_template — إنشاء نموذج CG جديد (pdf_based_weekly) لدور وظيفي
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_cg_template(p_session_token text, p_department_id bigint, p_job_role text, p_template jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s record; v_id bigint; v_actor text; v_role text;
begin
  select * into s from public.verify_session(p_session_token);
  if not coalesce(s.is_valid,false) then return jsonb_build_object('ok',false,'message','انتهت الجلسة'); end if;
  if s.role not in ('admin','quality_officer') then return jsonb_build_object('ok',false,'message','ليس لديك صلاحية'); end if;
  if p_template is null or jsonb_typeof(p_template)<>'object' then return jsonb_build_object('ok',false,'message','بنية القالب غير صالحة'); end if;
  v_role := nullif(trim(coalesce(p_job_role,'')),'');
  if v_role is null then return jsonb_build_object('ok',false,'message','المعرّف التقني (job_role) مطلوب'); end if;
  if v_role !~ '^[a-z0-9_]+$' then return jsonb_build_object('ok',false,'message','المعرّف التقني: أحرف إنجليزية صغيرة وأرقام و_ فقط'); end if;
  if exists(select 1 from public.evaluation_templates where department_id=p_department_id and job_role=v_role)
    then return jsonb_build_object('ok',false,'message','يوجد نموذج بهذا المعرّف (job_role) مسبقاً'); end if;
  insert into public.evaluation_templates(department_id, job_role, template_type, template_jsonb, version, is_active, updated_by, updated_at)
  values(p_department_id, v_role, 'pdf_based_weekly', p_template || jsonb_build_object('job_role',v_role), 1, true, s.user_id, now())
  returning id into v_id;
  select full_name::text into v_actor from public.users where id=s.user_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), s.user_id, coalesce(v_actor,'النظام'), s.role,
    'create_template','evaluation_template',v_id,'إنشاء نموذج CG جديد / '||v_role, now());
  return jsonb_build_object('ok',true,'id',v_id);
end; $function$;

-- -------------------------------------------------------------------------
-- upsert_evaluation_template — إنشاء/تحديث نموذج قسم (section_based افتراضياً)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_evaluation_template(p_session_token text, p_department_id bigint, p_template jsonb, p_template_type text DEFAULT 'section_based'::text, p_job_role text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s record; v_id bigint; v_actor text; v_role text;
begin
  select * into s from public.verify_session(p_session_token);
  if not coalesce(s.is_valid,false) then return jsonb_build_object('ok',false,'message','انتهت الجلسة'); end if;
  if s.role not in ('admin','quality_officer') then return jsonb_build_object('ok',false,'message','ليس لديك صلاحية لتعديل النماذج'); end if;
  if p_template is null or jsonb_typeof(p_template) <> 'object' then return jsonb_build_object('ok',false,'message','بنية القالب غير صالحة'); end if;
  v_role := nullif(trim(coalesce(p_job_role,'')),'');
  insert into public.evaluation_templates(department_id, job_role, template_type, template_jsonb, version, updated_by, updated_at)
  values (p_department_id, v_role, coalesce(p_template_type,'section_based'), p_template, 1, s.user_id, now())
  on conflict on constraint uq_dept_role do update set template_jsonb=excluded.template_jsonb, template_type=excluded.template_type,
    version=public.evaluation_templates.version+1, updated_by=s.user_id, updated_at=now()
  returning id into v_id;
  select full_name::text into v_actor from public.users where id = s.user_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), s.user_id, coalesce(v_actor,'النظام'), s.role,
    'upsert_template','evaluation_template', v_id, 'تحديث نموذج القسم #'||p_department_id||coalesce(' / '||v_role,''), now());
  return jsonb_build_object('ok',true,'id',v_id);
end; $function$;

-- -------------------------------------------------------------------------
-- المنح (نمط الملفات 36–38)
-- -------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_cg_template(text,bigint,text,jsonb)                 FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_cg_template(text,bigint,text,jsonb)               TO anon, authenticated;

REVOKE ALL ON FUNCTION public.upsert_evaluation_template(text,bigint,jsonb,text,text)     FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_evaluation_template(text,bigint,jsonb,text,text)   TO anon, authenticated;

-- =========================================================================
-- تحقّق:
--   SELECT proname, oid::regprocedure, proacl FROM pg_proc
--   WHERE pronamespace='public'::regnamespace
--     AND proname IN ('create_cg_template','upsert_evaluation_template');
-- =========================================================================
