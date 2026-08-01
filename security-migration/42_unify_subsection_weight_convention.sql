-- =========================================================================
-- 42_unify_subsection_weight_convention.sql  (#29 — الخيار 1)
-- توحيد قناعة أوزان الأقسام الفرعية: المُحقّق يطابق محرّكي الحساب.
--
-- قبل: _validate_template_sections يشترط مجموع أوزان الفرعية داخل كل قسم = 100.
-- بعد: يشترط مجموعها = **وزن القسم** — مطابقاً لـ calculateScores (عميل) و
--       compute_evaluation_scores_v2 (خادم) اللذين يجمعان أوزان الفرعية بلا قياس
--       بوزن القسم (فالقالب الافتراضي: قسم4 فرعياته 8.5+8.5+2+3+3=25=وزنه).
--
-- لا مساس بمحرّكي الحساب ولا بـ create_evaluation ولا بالتقييمات المخزّنة (snapshot).
-- لا هجرة بيانات (كل القوالب الحالية متوافقة مع هذه القناعة — تدقيق مُسبق).
-- المتن منسوخ حرفياً من ملف 37 عدا سطر التحقّق من مجموع الفرعية. REVOKE/GRANT كما 37/38.
-- التاريخ: 2026-08-01
-- =========================================================================

CREATE OR REPLACE FUNCTION public._validate_template_sections(p_type text, p_sections jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare s jsonb; sub jsonb; it jsonb; c jsonb;
  v_ssum numeric; v_subsum numeric; v_csum numeric; v_ids text[]; v_sw numeric;
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
    v_sw := coalesce((s->>'weight')::numeric,0);
    v_ssum := v_ssum + v_sw;
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
    -- (#29 الخيار 1) مجموع أوزان الفرعية = وزن القسم (مطابقة المحرّكات) — بدل =100
    if round(v_subsum) <> round(v_sw) then
      return 'مجموع أوزان الأقسام الفرعية داخل «'||(s->>'key')||'» = '||v_subsum||'% (يجب أن يساوي وزن القسم = '||v_sw||'%)'; end if;
  end loop;
  if round(v_ssum) <> 100 then return 'مجموع أوزان الأقسام = '||v_ssum||'% (يجب أن يكون 100%)'; end if;
  return null;
end; $function$;

-- المنح (كما 37/38: داخلي عن PUBLIC، متاح لـ anon/authenticated لخدمة تحقّق العميل م25)
REVOKE ALL ON FUNCTION public._validate_template_sections(text,jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public._validate_template_sections(text,jsonb) TO anon, authenticated;

-- =========================================================================
-- تحقّق: القالب الافتراضي (قسم4 فرعياته تجمع وزنه) يجب أن يمرّ الآن؛
--        وقالب فرعياته تجمع 100 مع وزن قسم≠100 يجب أن يُرفض.
-- =========================================================================
