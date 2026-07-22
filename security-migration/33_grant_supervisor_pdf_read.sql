-- ============================================================
-- ملف 33 (م22): السماح للمشرف بقراءة PDF تقييمات موظفيه فقط
-- ============================================================
-- الخلفية: get_pdf_download_url و get_cg_week_pdf_url كانتا تسمحان بفتح PDF
-- لـ (admin / quality_officer / الموظف نفسه) فقط — supervisor محذوف تماماً،
-- فيرى «ليس لديك صلاحية لعرض هذا الملف» عند فتح تقييم موظفه (م22).
--
-- القرار (مقيّد بالفريق — أقل صلاحية): يُضاف supervisor للقراءة لكن فقط
-- لموظفيه المباشرين (users.supervisor_id = session.user_id).
--
-- التعديل الوحيد: شرط الدور (if not (...) then) في كلتا الدالتين. بقية الجسم
-- (verify_session، توليد الـsigned URL عبر vault + extensions.http، v_base،
-- الرسائل) منسوخ حرفياً بلا أي مساس.
--
-- تاريخ التنفيذ: 2026-07-23
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) get_pdf_download_url (text, bigint)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_pdf_download_url(p_session_token text, p_evaluation_id bigint)
 RETURNS TABLE(ok boolean, url text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sess record; v_eval public.evaluations; v_key text; v_content text; v_signed text;
  v_base constant text := 'https://hobhajqtgcyctfmcxkel.supabase.co';
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,null::text,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  select * into v_eval from public.evaluations where id = p_evaluation_id;
  if v_eval.id is null then return query select false,null::text,'التقييم غير موجود'::text; return; end if;
  if v_eval.pdf_file_path is null then return query select false,null::text,'لا يوجد ملف PDF لهذا التقييم'::text; return; end if;
  if not (
      v_sess.role in ('admin','quality_officer')
      or v_sess.user_id = v_eval.employee_id
      or (v_sess.role = 'supervisor' and exists(
          select 1 from public.users u
          where u.id = v_eval.employee_id and u.supervisor_id = v_sess.user_id
      ))
  ) then
    return query select false,null::text,'ليس لديك صلاحية لعرض هذا الملف'::text; return;
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name='service_role_key' limit 1;
  if v_key is null then return query select false,null::text,'مفتاح التوقيع غير متوفّر'::text; return; end if;
  select (r).content into v_content from extensions.http((
      'POST',
      v_base||'/storage/v1/object/sign/creative-gene-pdfs/'||v_eval.pdf_file_path,
      array[extensions.http_header('apikey', v_key), extensions.http_header('Authorization','Bearer '||v_key)],
      'application/json',
      '{"expiresIn":3600}'
    )::extensions.http_request) as r;
  v_signed := (v_content::jsonb)->>'signedURL';
  if v_signed is null then return query select false,null::text,'تعذّر توليد الرابط الموقّع'::text; return; end if;
  return query select true, v_base||'/storage/v1'||v_signed, 'تم'::text;
end; $function$;

-- ------------------------------------------------------------
-- 2) get_cg_week_pdf_url (text, bigint, date)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_cg_week_pdf_url(p_session_token text, p_employee_id bigint, p_week_start date)
 RETURNS TABLE(ok boolean, url text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sess record; v_path text; v_key text; v_content text; v_signed text;
  v_base constant text := 'https://hobhajqtgcyctfmcxkel.supabase.co';
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,null::text,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if not (
      v_sess.role in ('admin','quality_officer')
      or v_sess.user_id = p_employee_id
      or (v_sess.role = 'supervisor' and exists(
          select 1 from public.users u
          where u.id = p_employee_id and u.supervisor_id = v_sess.user_id
      ))
  ) then
    return query select false,null::text,'ليس لديك صلاحية لعرض هذا الملف'::text; return; end if;
  select pdf_file_path into v_path from public.creative_gene_weekly_status where employee_id=p_employee_id and week_start=p_week_start;
  if v_path is null then return query select false,null::text,'لا يوجد ملف لهذا الأسبوع'::text; return; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name='service_role_key' limit 1;
  if v_key is null then return query select false,null::text,'مفتاح التوقيع غير متوفّر'::text; return; end if;
  select (r).content into v_content from extensions.http((
      'POST', v_base||'/storage/v1/object/sign/creative-gene-pdfs/'||v_path,
      array[extensions.http_header('apikey', v_key), extensions.http_header('Authorization','Bearer '||v_key)],
      'application/json', '{"expiresIn":3600}'
    )::extensions.http_request) as r;
  v_signed := (v_content::jsonb)->>'signedURL';
  if v_signed is null then return query select false,null::text,'تعذّر توليد الرابط'::text; return; end if;
  return query select true, v_base||'/storage/v1'||v_signed, 'تم'::text;
end; $function$;

COMMIT;

-- ============================================================
-- تحقّق بعد التنفيذ (يجب أن يظهر شرط supervisor في التعريف الجديد):
--   SELECT pg_get_functiondef(p.oid)
--   FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
--     AND p.proname IN ('get_pdf_download_url','get_cg_week_pdf_url');
-- ============================================================
