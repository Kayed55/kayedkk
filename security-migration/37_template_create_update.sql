-- =========================================================================
-- 37_template_create_update.sql  (م24-ج)
-- create_template + update_template — تبنيان البنية الداخلية الحالية المتوافقة
-- مع المحرّكين (compute_evaluation_scores_v2 لمحزم، compute_pdf_weighted لـCG).
-- الخيار (أ): لا مساس بدوال الحساب ولا create_evaluation.
-- =========================================================================
-- البنى المعتمدة:
--   section_based → {answers:{OK,ERR,NA}, sections:[{key,type,title,weight,
--                    subsections:[{key,title,weight,items:[{key,label}]}]}]}
--     تحقّق: أوزان الأقسام=100، أوزان الأقسام الفرعية داخل كل قسم=100،
--            type∈(critical,non-critical)، كل بند key+label، answers ثابتة (id=1).
--   pdf_based_weekly → {criteria:[{id,name,weight}]}
--     تحقّق: أوزان المعايير=100، id فريد، name مطلوب.
-- الأمان: SECURITY DEFINER + REVOKE/GRANT (anon+authenticated). template_snapshot محمي.
-- التاريخ: 2026-07-25
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- مُحقّق البنية (داخلي) — يُرجع نص خطأ أو NULL عند السلامة
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._validate_template_sections(p_type text, p_sections jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare s jsonb; sub jsonb; it jsonb; c jsonb;
  v_ssum numeric; v_subsum numeric; v_csum numeric; v_ids text[];
begin
  if p_sections is null or jsonb_typeof(p_sections) <> 'array' or jsonb_array_length(p_sections)=0 then
    return 'يجب توفير عناصر النموذج (مصفوفة غير فارغة)'; end if;

  if p_type = 'pdf_based_weekly' then
    v_csum := 0; v_ids := array[]::text[];
    for c in select value from jsonb_array_elements(p_sections) loop
      if coalesce(trim(c->>'id'),'')='' then return 'كل معيار يحتاج معرّفاً (id)'; end if;
      if coalesce(trim(c->>'name'),'')='' then return 'كل معيار يحتاج اسماً (name)'; end if;
      if (c->>'id') = any(v_ids) then return 'معرّف معيار مكرّر: '||(c->>'id'); end if;
      v_ids := v_ids || (c->>'id');
      v_csum := v_csum + coalesce((c->>'weight')::numeric,0);
    end loop;
    if round(v_csum) <> 100 then return 'مجموع أوزان المعايير = '||v_csum||'% (يجب أن يكون 100%)'; end if;
    return null;
  end if;

  -- section_based
  v_ssum := 0;
  for s in select value from jsonb_array_elements(p_sections) loop
    if coalesce(trim(s->>'key'),'')='' then return 'كل قسم يحتاج key'; end if;
    if coalesce(trim(s->>'title'),'')='' then return 'كل قسم يحتاج عنواناً (title)'; end if;
    if (s->>'type') not in ('critical','non-critical') then return 'نوع القسم «'||(s->>'key')||'» يجب أن يكون critical أو non-critical'; end if;
    if jsonb_typeof(s->'subsections') <> 'array' or jsonb_array_length(s->'subsections')=0 then
      return 'الأقسام الفرعية للقسم «'||(s->>'key')||'» يجب أن تكون مصفوفة غير فارغة'; end if;
    v_ssum := v_ssum + coalesce((s->>'weight')::numeric,0);
    v_subsum := 0;
    for sub in select value from jsonb_array_elements(s->'subsections') loop
      if coalesce(trim(sub->>'key'),'')='' then return 'كل قسم فرعي يحتاج key'; end if;
      if jsonb_typeof(sub->'items') <> 'array' or jsonb_array_length(sub->'items')=0 then
        return 'بنود القسم الفرعي «'||(sub->>'key')||'» يجب أن تكون مصفوفة غير فارغة'; end if;
      v_subsum := v_subsum + coalesce((sub->>'weight')::numeric,0);
      for it in select value from jsonb_array_elements(sub->'items') loop
        if coalesce(trim(it->>'key'),'')='' or coalesce(trim(it->>'label'),'')='' then
          return 'كل بند يحتاج key و label في القسم الفرعي «'||(sub->>'key')||'»'; end if;
      end loop;
    end loop;
    if round(v_subsum) <> 100 then return 'مجموع أوزان الأقسام الفرعية داخل «'||(s->>'key')||'» = '||v_subsum||'% (يجب أن يكون 100%)'; end if;
  end loop;
  if round(v_ssum) <> 100 then return 'مجموع أوزان الأقسام = '||v_ssum||'% (يجب أن يكون 100%)'; end if;
  return null;
end; $function$;

-- -------------------------------------------------------------------------
-- create_template
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_template(
  p_session_token text, p_department_id bigint, p_name text, p_job_role text,
  p_template_type text, p_sections jsonb, p_meta jsonb DEFAULT '{}'::jsonb
)
 RETURNS TABLE(ok boolean, template_id bigint, message text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_sess record; v_id bigint; v_jsonb jsonb; v_err text; v_jr text;
  v_answers constant jsonb := '{"OK":"لا يوجد خطأ","ERR":"يوجد خطأ","NA":"لا ينطبق"}'::jsonb;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,null::bigint,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if v_sess.role not in ('admin','quality_officer') then return query select false,null::bigint,'ليس لديك صلاحية'::text; return; end if;
  if not exists(select 1 from public.departments where id=p_department_id) then return query select false,null::bigint,'القسم غير موجود'::text; return; end if;
  if p_template_type not in ('section_based','pdf_based_weekly') then return query select false,null::bigint,'نوع النموذج غير مدعوم'::text; return; end if;
  if p_name is null or p_name !~ '^[a-z][a-z0-9_]{1,49}$' then return query select false,null::bigint,'اسم النموذج يجب أن يبدأ بحرف إنجليزي صغير ويحوي حروفاً صغيرة/أرقاماً/شرطة سفلية (2–50 حرفاً)'::text; return; end if;
  if exists(select 1 from public.evaluation_templates where department_id=p_department_id and name=p_name) then return query select false,null::bigint,'يوجد نموذج بنفس الاسم في هذا القسم'::text; return; end if;
  v_jr := nullif(trim(p_job_role),'');
  if v_jr is not null then
    if v_jr !~ '^[a-z][a-z0-9_]{1,49}$' then return query select false,null::bigint,'الدور (job_role) صيغته غير صحيحة'::text; return; end if;
    if exists(select 1 from public.evaluation_templates where department_id=p_department_id and job_role=v_jr) then return query select false,null::bigint,'الدور (job_role) مستخدم في هذا القسم'::text; return; end if;
  end if;
  v_err := public._validate_template_sections(p_template_type, p_sections);
  if v_err is not null then return query select false,null::bigint,v_err; return; end if;

  if p_template_type='section_based' then v_jsonb := jsonb_build_object('answers', v_answers, 'sections', p_sections);
  else v_jsonb := jsonb_build_object('criteria', p_sections); end if;

  insert into public.evaluation_templates
    (department_id, template_type, template_jsonb, version, is_active, status, job_role, name, updated_by, created_at, updated_at)
  values
    (p_department_id, p_template_type, v_jsonb, 1, true, 'active', v_jr, p_name, v_sess.user_id, now(), now())
  returning id into v_id;
  return query select true, v_id, 'تم إنشاء النموذج'::text;
end; $function$;

-- -------------------------------------------------------------------------
-- update_template — يمنع تغيير النوع + يمنع التعديل إن استُخدم في تقييمات
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_template(
  p_session_token text, p_id bigint, p_name text, p_job_role text, p_sections jsonb, p_meta jsonb DEFAULT '{}'::jsonb
)
 RETURNS TABLE(ok boolean, message text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_sess record; v_t public.evaluation_templates; v_jsonb jsonb; v_err text; v_jr text;
  v_answers constant jsonb := '{"OK":"لا يوجد خطأ","ERR":"يوجد خطأ","NA":"لا ينطبق"}'::jsonb;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if v_sess.role not in ('admin','quality_officer') then return query select false,'ليس لديك صلاحية'::text; return; end if;
  select * into v_t from public.evaluation_templates where id=p_id;
  if v_t.id is null then return query select false,'النموذج غير موجود'::text; return; end if;

  -- يمنع التعديل إن استُخدم في تقييمات (اللقطات محفوظة؛ نفرض النسخ لإصدار جديد)
  if exists(select 1 from public.evaluations ev join public.users u on u.id=ev.employee_id
            where u.department_id=v_t.department_id and u.job_role is not distinct from v_t.job_role) then
    return query select false,'لا يمكن تعديل نموذج استُخدم في تقييمات — استخدم «نسخ» (copy) لإصدار جديد'::text; return;
  end if;

  if p_name is null or p_name !~ '^[a-z][a-z0-9_]{1,49}$' then return query select false,'اسم النموذج يجب أن يبدأ بحرف إنجليزي صغير ويحوي حروفاً صغيرة/أرقاماً/شرطة سفلية (2–50)'::text; return; end if;
  if exists(select 1 from public.evaluation_templates where department_id=v_t.department_id and name=p_name and id<>p_id) then return query select false,'يوجد نموذج بنفس الاسم في هذا القسم'::text; return; end if;
  v_jr := nullif(trim(p_job_role),'');
  if v_jr is not null then
    if v_jr !~ '^[a-z][a-z0-9_]{1,49}$' then return query select false,'الدور (job_role) صيغته غير صحيحة'::text; return; end if;
    if exists(select 1 from public.evaluation_templates where department_id=v_t.department_id and job_role=v_jr and id<>p_id) then return query select false,'الدور (job_role) مستخدم في هذا القسم'::text; return; end if;
  end if;
  v_err := public._validate_template_sections(v_t.template_type, p_sections);   -- النوع من الصف (لا يتغيّر)
  if v_err is not null then return query select false,v_err; return; end if;

  if v_t.template_type='section_based' then v_jsonb := jsonb_build_object('answers', v_answers, 'sections', p_sections);
  else v_jsonb := jsonb_build_object('criteria', p_sections); end if;

  update public.evaluation_templates set
    name=p_name, job_role=v_jr, template_jsonb=v_jsonb, version=version+1, updated_by=v_sess.user_id, updated_at=now()
  where id=p_id;
  return query select true,'تم تحديث النموذج'::text;
end; $function$;

-- -------------------------------------------------------------------------
-- المنح
-- -------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._validate_template_sections(text,jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_template(text,bigint,text,text,text,jsonb,jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_template(text,bigint,text,text,text,jsonb,jsonb) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.update_template(text,bigint,text,text,jsonb,jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_template(text,bigint,text,text,jsonb,jsonb) TO anon, authenticated;

COMMIT;

-- =========================================================================
-- تحقّق:
--   SELECT proname, pronargs FROM pg_proc WHERE pronamespace='public'::regnamespace
--     AND proname IN ('create_template','update_template','_validate_template_sections');
-- =========================================================================
