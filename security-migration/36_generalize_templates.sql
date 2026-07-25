-- =========================================================================
-- 36_generalize_templates.sql  (م24-ب)
-- تعميم إدارة النماذج: عمودا name + status + قيود + trigger مزامنة (المرحلة
-- المزدوجة is_active↔status) + دوال إدارة عامة (قراءة/حالة/نسخ/حذف).
-- =========================================================================
-- ⚠️ نفّذ backup_scripts/backup_templates_20260725.sql **أولاً**.
--
-- المرحلة المزدوجة (حرجة): لا نمسّ القارئات اليومية (create_evaluation إلخ)
-- التي تعتمد is_active. بدلاً من ذلك، trigger يبقي is_active مرآةً لـ status:
--   • كتابة status (الدوال الجديدة) → is_active يُشتق.
--   • كتابة is_active (RPCs قديمة) → status يُشتق (دون إخراج من الأرشيف).
-- هكذا يبقى النظام متسقاً حتى تُنقَل القارئات إلى status في م24-و.
--
-- نطاق م24-ب: DDL + backfill + trigger + list/set_status/delete/copy.
-- (create_template/update_template — تحقّق jsonb خاص بالنوع — في م24-ج.)
--
-- الأمان: template_snapshot في evaluations مُجمّد → لا يتأثر إطلاقاً.
-- كل الدوال SECURITY DEFINER + REVOKE/GRANT (anon+authenticated: مفتاح anon).
-- التاريخ: 2026-07-25
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- (1) الأعمدة الجديدة (nullable مؤقتاً)
-- -------------------------------------------------------------------------
ALTER TABLE public.evaluation_templates
  ADD COLUMN IF NOT EXISTS name   text,
  ADD COLUMN IF NOT EXISTS status text;

-- -------------------------------------------------------------------------
-- (2) backfill: الاسم (فريد داخل القسم — تحقّقنا مسبقاً) + الحالة من is_active
-- -------------------------------------------------------------------------
UPDATE public.evaluation_templates
  SET name = coalesce(nullif(trim(job_role), ''), 'النموذج الافتراضي')
  WHERE name IS NULL;

UPDATE public.evaluation_templates
  SET status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END
  WHERE status IS NULL;

-- -------------------------------------------------------------------------
-- (3) القيود: NOT NULL + CHECK + تفرّد الاسم داخل القسم
--     (لا DEFAULT على status عمداً — الـtrigger هو مصدر التزامن)
-- -------------------------------------------------------------------------
ALTER TABLE public.evaluation_templates
  ALTER COLUMN name   SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ADD CONSTRAINT chk_template_status CHECK (status IN ('active','inactive','archived')),
  ADD CONSTRAINT unique_name_per_dept UNIQUE (department_id, name);

-- -------------------------------------------------------------------------
-- (4) trigger المزامنة ثنائية الاتجاه (المرحلة المزدوجة)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_template_status_active()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if TG_OP = 'INSERT' then
    -- status غير مُمرّر (RPC قديم) → اشتقّه من is_active؛ وإلا اعتمد status
    if NEW.status is null then
      NEW.status := case when coalesce(NEW.is_active, true) then 'active' else 'inactive' end;
    end if;
    NEW.is_active := (NEW.status = 'active');
  else -- UPDATE
    if NEW.status is distinct from OLD.status then
      NEW.is_active := (NEW.status = 'active');                       -- status هو المصدر
    elsif NEW.is_active is distinct from OLD.is_active then
      NEW.status := case when OLD.status = 'archived' then 'archived' -- لا نُخرج من الأرشيف عبر is_active
                         when NEW.is_active then 'active' else 'inactive' end;
    end if;
  end if;
  return NEW;
end; $function$;

DROP TRIGGER IF EXISTS trg_sync_template_status ON public.evaluation_templates;
CREATE TRIGGER trg_sync_template_status
  BEFORE INSERT OR UPDATE ON public.evaluation_templates
  FOR EACH ROW EXECUTE FUNCTION public.sync_template_status_active();

-- -------------------------------------------------------------------------
-- (5) list_templates — عام لكل الأقسام + عدّادات (بنود + موظفون)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_templates(p_session_token text, p_department_id bigint)
 RETURNS TABLE(id bigint, name text, job_role text, template_type text, status text,
               is_active boolean, version integer, updated_at timestamptz,
               item_count integer, employee_count integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_sess record;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return; end if;
  if v_sess.role not in ('admin','quality_officer') then return; end if;
  return query
  select t.id, t.name, t.job_role, t.template_type, t.status, t.is_active, t.version, t.updated_at,
    case
      when t.template_type='pdf_based_weekly' and jsonb_typeof(t.template_jsonb->'criteria')='array'
        then jsonb_array_length(t.template_jsonb->'criteria')
      when t.template_type='section_based'
        then coalesce((select sum(jsonb_array_length(sub->'items'))::int
                       from jsonb_array_elements(t.template_jsonb->'sections') s,
                            jsonb_array_elements(s->'subsections') sub
                       where jsonb_typeof(sub->'items')='array'),0)
      else 0
    end as item_count,
    (select count(*)::int from public.users u
       where u.department_id=t.department_id and u.job_role is not distinct from t.job_role) as employee_count
  from public.evaluation_templates t
  where t.department_id = p_department_id and t.status <> 'archived'
  order by (t.job_role is null) desc, t.name;
end; $function$;

-- -------------------------------------------------------------------------
-- (6) set_template_status — active/inactive/archived (يمنع تعطيل آخر نشط)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_template_status(p_session_token text, p_id bigint, p_status text)
 RETURNS TABLE(ok boolean, message text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_sess record; v_t public.evaluation_templates;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if v_sess.role not in ('admin','quality_officer') then return query select false,'ليس لديك صلاحية'::text; return; end if;
  if p_status not in ('active','inactive','archived') then return query select false,'حالة غير صالحة'::text; return; end if;
  select * into v_t from public.evaluation_templates where id=p_id;
  if v_t.id is null then return query select false,'النموذج غير موجود'::text; return; end if;
  if p_status <> 'active' and (select count(*) from public.evaluation_templates
        where department_id=v_t.department_id and status='active' and id<>p_id) = 0 then
    return query select false,'لا يمكن تعطيل/أرشفة آخر نموذج نشط للقسم'::text; return;
  end if;
  update public.evaluation_templates set status=p_status, updated_by=v_sess.user_id, updated_at=now() where id=p_id;
  return query select true, ('تم تحديث الحالة إلى '||p_status)::text;
end; $function$;

-- -------------------------------------------------------------------------
-- (7) copy_template — نسخ داخل نفس القسم باسم/دور جديد
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.copy_template(p_session_token text, p_id bigint, p_new_name text, p_new_job_role text DEFAULT NULL)
 RETURNS TABLE(ok boolean, new_id bigint, message text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_sess record; v_src public.evaluation_templates; v_id bigint; v_jr text;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,null::bigint,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if v_sess.role not in ('admin','quality_officer') then return query select false,null::bigint,'ليس لديك صلاحية'::text; return; end if;
  select * into v_src from public.evaluation_templates where id=p_id;
  if v_src.id is null then return query select false,null::bigint,'النموذج المصدر غير موجود'::text; return; end if;
  if coalesce(trim(p_new_name),'')='' then return query select false,null::bigint,'اسم النموذج الجديد مطلوب'::text; return; end if;
  if exists(select 1 from public.evaluation_templates where department_id=v_src.department_id and name=trim(p_new_name)) then
    return query select false,null::bigint,'يوجد نموذج بنفس الاسم في هذا القسم'::text; return; end if;
  v_jr := nullif(trim(p_new_job_role),'');
  if v_jr is not null and v_jr !~ '^[a-z][a-z0-9_]{1,49}$' then
    return query select false,null::bigint,'الدور (job_role) يجب أن يبدأ بحرف إنجليزي صغير ويحوي حروفاً صغيرة/أرقام/شرطة سفلية'::text; return; end if;
  if v_jr is not null and exists(select 1 from public.evaluation_templates where department_id=v_src.department_id and job_role=v_jr) then
    return query select false,null::bigint,'الدور (job_role) مستخدم في هذا القسم'::text; return; end if;
  insert into public.evaluation_templates
    (department_id, template_type, template_jsonb, version, is_active, status, job_role, name, updated_by, created_at, updated_at)
  values
    (v_src.department_id, v_src.template_type, v_src.template_jsonb, 1, true, 'active', v_jr, trim(p_new_name), v_sess.user_id, now(), now())
  returning id into v_id;
  return query select true, v_id, 'تم نسخ النموذج'::text;
end; $function$;

-- -------------------------------------------------------------------------
-- (8) delete_template — يمنع الحذف إن مستخدَم → يقترح الأرشفة
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_template(p_session_token text, p_id bigint)
 RETURNS TABLE(ok boolean, message text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_sess record; v_t public.evaluation_templates; v_emp int;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if v_sess.role not in ('admin','quality_officer') then return query select false,'ليس لديك صلاحية'::text; return; end if;
  select * into v_t from public.evaluation_templates where id=p_id;
  if v_t.id is null then return query select false,'النموذج غير موجود'::text; return; end if;
  select count(*) into v_emp from public.users u
    where u.department_id=v_t.department_id and u.job_role is not distinct from v_t.job_role;
  if v_emp > 0 then
    return query select false, ('لا يمكن الحذف — يستخدمه '||v_emp||' موظف. استخدم الأرشفة بدلاً من الحذف.')::text; return;
  end if;
  delete from public.evaluation_templates where id=p_id;
  return query select true, 'تم حذف النموذج'::text;
end; $function$;

-- -------------------------------------------------------------------------
-- (9) المنح
-- -------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.list_templates(text,bigint)                 FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_templates(text,bigint)               TO anon, authenticated;
REVOKE ALL ON FUNCTION public.set_template_status(text,bigint,text)        FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_template_status(text,bigint,text)      TO anon, authenticated;
REVOKE ALL ON FUNCTION public.copy_template(text,bigint,text,text)         FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.copy_template(text,bigint,text,text)       TO anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_template(text,bigint)                 FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_template(text,bigint)               TO anon, authenticated;

COMMIT;

-- =========================================================================
-- تحقّق بعد التنفيذ:
--   -- الأعمدة والقيود:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='evaluation_templates' AND column_name IN ('name','status');
--   -- backfill سليم (لا NULL، أسماء فريدة داخل القسم):
--   SELECT department_id, name, status, is_active FROM public.evaluation_templates ORDER BY department_id, name;
--   -- المزامنة (اختبار): تعطيل ثم تفعيل عبر status و is_active يبقيان متوافقين.
--   -- الدوال الأربع موجودة:
--   SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace
--     AND proname IN ('list_templates','set_template_status','copy_template','delete_template');
-- =========================================================================
