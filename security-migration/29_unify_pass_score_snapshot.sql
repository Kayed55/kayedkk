-- ============================================================================
-- م19 (توحيد النجاح/الرسوب): لقطة درجة النجاح لكل تقييم — pass_score_snapshot
-- ----------------------------------------------------------------------------
-- المشكلة:
--   • عتبة النجاح مثبّتة على 85 في الخادم (compute_evaluation_scores) وفي العميل
--     (gradeBadge/gradeLabel)، بينما لكل قسم درجة نجاح خاصة في departments.pass_score:
--        الإدارة (1) = 80 ، محزم (2) = 80 ، كريتف جين (3) = 90.
--   • النتيجة: التقييمات تُصنَّف ناجح/راسب على 85 بشكل خاطئ بدل درجة قسم الموظف،
--     ويوجد في العميل نظامان متوازيان (gradeBadge=85 مقابل passFailBadge=درجة القسم).
--
-- الحل (نهج اللقطة/Snapshot):
--   • نُضيف عمودًا pass_score_snapshot يُجمّد درجة نجاح قسم الموظف داخل كل تقييم
--     وقت الإنشاء، ونحتسب grade/status على أساسه.
--   • هكذا لا يتغيّر تصنيف تقييم قديم لو عُدّلت درجة القسم لاحقًا (سلامة تاريخية).
--
-- سياسة التقييمات القديمة:
--   • تبقى جميعها على عتبة 85 (العتبة التاريخية التي حُسِبت بها فعليًا) — لا نُعيد
--     احتساب grade/status لها إطلاقًا حتى لا ننقلب تقييمًا كان "ناجح" إلى "راسب".
--
-- الأمان/التوافق:
--   • توقيعات الدوال العامة create_evaluation / admin_update_evaluation تبقى كما هي
--     تمامًا (نفس التواقيع من ملف 25) → لا كسر لواجهة العميل، فقط منطق داخلي + عمود.
--   • compute_evaluation_scores يصبح بمعامل عتبة اختياري (افتراضي 85) — أي استدعاء
--     قديم بمعامل واحد يظل يعمل عبر الـ default.
--
-- ⚠️ حدود هذا الملف (تُعالَج لاحقًا — انظر ملاحظات النهاية):
--   • التقييم الأسبوعي (create_weekly_evaluation) غير معرّف في مجلد security-migration
--     (مطبّق على القاعدة مباشرة) → لن يحصل على لقطة من هنا؛ صفوفه ستبقى
--     pass_score_snapshot = NULL ويسقط العميل إلى 85 كـ fallback.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- (1) عمود اللقطة
-- ----------------------------------------------------------------------------
alter table public.evaluations
  add column if not exists pass_score_snapshot numeric;

comment on column public.evaluations.pass_score_snapshot is
  'لقطة درجة نجاح قسم الموظف وقت إنشاء التقييم (تُجمّد التصنيف تاريخيًا). NULL = تقييم قديم/أسبوعي → يُعامَل كـ 85.';

-- ----------------------------------------------------------------------------
-- (2) ترحيل التقييمات القديمة: تبقى على العتبة التاريخية 85 (بلا إعادة احتساب)
-- ----------------------------------------------------------------------------
update public.evaluations
   set pass_score_snapshot = 85
 where pass_score_snapshot is null;

-- ملاحظة صريحة: لا UPDATE على grade/status هنا. التصنيف التاريخي يبقى كما سُجّل.

-- ----------------------------------------------------------------------------
-- (3) دالة الاحتساب: عتبة نجاح اختيارية (افتراضي 85 للتوافق الخلفي)
--     نُسقط النسخة أحادية المعامل ثم نُنشئ نسخة بمعاملين لتفادي الـ overload.
-- ----------------------------------------------------------------------------
drop function if exists public.compute_evaluation_scores(jsonb);

create or replace function public.compute_evaluation_scores(
  p_items      jsonb,
  p_pass_score numeric default 85
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_crit     jsonb;
  v_ok text; v_err text; v_na text;
  v_section jsonb; v_sub jsonb; v_item jsonb;
  v_total numeric := 0; v_sscore numeric; v_sstotal numeric;
  v_applicable int; v_correct int; v_haserror boolean; v_ans text;
  v_scores jsonb := '{}'::jsonb; v_pct numeric; v_grade text;
  v_pass numeric := coalesce(p_pass_score, 85);   -- عتبة النجاح الفعلية
begin
  select config_value into v_crit from public.criteria_config where config_key = 'criteria' limit 1;
  if v_crit is null then return jsonb_build_object('error','no_criteria'); end if;
  v_ok := v_crit->'answers'->>'OK'; v_err := v_crit->'answers'->>'ERR'; v_na := v_crit->'answers'->>'NA';
  if p_items is null or jsonb_typeof(p_items) <> 'object' then p_items := '{}'::jsonb; end if;

  for v_section in select value from jsonb_array_elements(v_crit->'sections') loop
    if (v_section->>'type') = 'critical' then
      v_haserror := false;
      for v_sub in select value from jsonb_array_elements(v_section->'subsections') loop
        for v_item in select value from jsonb_array_elements(v_sub->'items') loop
          v_ans := coalesce(p_items->>(v_item->>'key'), v_ok);
          if v_ans = v_err then v_haserror := true; end if;
        end loop;
      end loop;
      v_sscore := case when v_haserror then 0 else (v_section->>'weight')::numeric end;
    else
      v_sstotal := 0;
      for v_sub in select value from jsonb_array_elements(v_section->'subsections') loop
        v_applicable := 0; v_correct := 0;
        for v_item in select value from jsonb_array_elements(v_sub->'items') loop
          v_ans := coalesce(p_items->>(v_item->>'key'), v_ok);
          if v_ans <> v_na then v_applicable := v_applicable + 1; end if;
          if v_ans = v_ok then v_correct := v_correct + 1; end if;
        end loop;
        if v_applicable > 0 then
          v_sstotal := v_sstotal + (v_correct::numeric / v_applicable) * (v_sub->>'weight')::numeric;
        else
          v_sstotal := v_sstotal + (v_sub->>'weight')::numeric;
        end if;
      end loop;
      v_sscore := round(v_sstotal * 10) / 10;
    end if;
    v_scores := v_scores || jsonb_build_object(v_section->>'key', v_sscore);
    v_total := v_total + v_sscore;
  end loop;

  v_total := round(v_total * 10) / 10;
  v_pct := v_total;
  -- ★ التغيير الجوهري: العتبة من الباراميتر (قسم الموظف) بدل 85 المثبّتة
  v_grade := case when v_pct >= v_pass then 'ناجح' else 'راسب' end;
  return jsonb_build_object('section_scores', v_scores, 'total_score', v_total,
                            'percentage', v_pct, 'grade', v_grade, 'status', v_grade);
end; $$;

revoke all on function public.compute_evaluation_scores(jsonb, numeric) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- (4) دالة مساعدة: درجة نجاح قسم الموظف (fallback 85 عند غياب القسم/الدرجة)
-- ----------------------------------------------------------------------------
create or replace function public.employee_pass_score(p_employee_id bigint)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select d.pass_score::numeric
       from public.users u
       join public.departments d on d.id = u.department_id
      where u.id = p_employee_id),
    85);
$$;

revoke all on function public.employee_pass_score(bigint) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- (5) إنشاء التقييم: يلتقط درجة نجاح قسم الموظف ويحتسب عليها ويخزّنها
--     (نفس توقيع ملف 25 حرفيًا — لا كسر للعميل)
-- ----------------------------------------------------------------------------
create or replace function public.create_evaluation(
  p_session_token text, p_employee_id bigint, p_evaluation_date date,
  p_observed_issue text default null, p_observed_issue_other text default null,
  p_action_taken text default null, p_action_taken_other text default null,
  p_notes text default null, p_items jsonb default '{}'::jsonb,
  p_communication_type text default null, p_communication_reference text default null
) returns table(ok boolean, evaluation_id bigint, percentage numeric, grade text, message text)
language plpgsql security definer set search_path to 'public'
as $function$
declare v_sess record; v_actor text; v_emp text; v_scores jsonb; v_id bigint; v_call text;
  v_pass numeric;                                   -- ★ لقطة درجة نجاح القسم
  v_allowed constant text[] := array['admin','quality_officer'];
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,null::bigint,null::numeric,null::text,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if not (v_sess.role = any(v_allowed)) then return query select false,null::bigint,null::numeric,null::text,'ليس لديك صلاحية لإنشاء تقييم'::text; return; end if;
  if p_employee_id is null or p_evaluation_date is null then return query select false,null::bigint,null::numeric,null::text,'الموظف والتاريخ مطلوبان'::text; return; end if;
  if p_communication_type is null or p_communication_type not in ('chat','call') then return query select false,null::bigint,null::numeric,null::text,'نوع التواصل مطلوب (محادثة/اتصال)'::text; return; end if;
  if coalesce(trim(p_communication_reference),'') = '' then return query select false,null::bigint,null::numeric,null::text,'مرجع التواصل (الرابط/الكود) مطلوب'::text; return; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'object' then p_items := '{}'::jsonb; end if;

  v_pass   := public.employee_pass_score(p_employee_id);          -- ★ التقاط العتبة
  v_scores := public.compute_evaluation_scores(p_items, v_pass);  -- ★ احتساب على عتبة القسم
  if v_scores ? 'error' then return query select false,null::bigint,null::numeric,null::text,'تعذّر احتساب الدرجة'::text; return; end if;

  v_id := (select coalesce(max(id),0)+1 from public.evaluations);
  v_call := case when p_observed_issue = 'أخرى' then coalesce(p_observed_issue_other, p_observed_issue) else p_observed_issue end;

  insert into public.evaluations(id, employee_id, evaluator_id, evaluation_date, call_type,
    observed_issue, observed_issue_other, action_taken, action_taken_other,
    supervisor_action, supervisor_action_other, supervisor_notes, supervisor_action_by, supervisor_action_by_name, supervisor_action_at,
    notes, items, section_scores, total_score, percentage, grade, status, approved,
    communication_type, communication_reference, pass_score_snapshot, created_at, updated_at)
  values(v_id, p_employee_id, v_sess.user_id, p_evaluation_date, coalesce(v_call,''),
    coalesce(p_observed_issue,''), coalesce(p_observed_issue_other,''), coalesce(p_action_taken,''), coalesce(p_action_taken_other,''),
    '', '', '', null, '', null,
    coalesce(p_notes,''), p_items, v_scores->'section_scores', (v_scores->>'total_score')::numeric, (v_scores->>'percentage')::numeric, v_scores->>'grade', v_scores->>'status', false,
    p_communication_type, trim(p_communication_reference), v_pass, now(), now());   -- ★ تخزين اللقطة

  insert into public.notifications(id,user_id,title,message,type,entity_type,entity_id,is_read,created_at)
  values((select coalesce(max(id),0)+1 from public.notifications), p_employee_id, 'تم استلام تقييم جديد',
    'تم تقييمك بنسبة '||(v_scores->>'percentage')||'% - '||(v_scores->>'grade'),
    case when (v_scores->>'status')='ناجح' then 'success' else 'warning' end, 'evaluation', v_id, false, now());

  select full_name::text into v_actor from public.users where id = v_sess.user_id;
  select full_name::text into v_emp from public.users where id = p_employee_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
    'create_evaluation','evaluation',v_id,'إنشاء تقييم #'||v_id||' للموظف '||coalesce(v_emp,'-')||' - '||(v_scores->>'percentage')||'% (عتبة '||v_pass||') — بواسطة '||coalesce(v_actor,'النظام'),now());

  return query select true, v_id, (v_scores->>'percentage')::numeric, (v_scores->>'grade')::text, 'تم إنشاء التقييم'::text;
end; $function$;
revoke all on function public.create_evaluation(text,bigint,date,text,text,text,text,text,jsonb,text,text) from public;
grant execute on function public.create_evaluation(text,bigint,date,text,text,text,text,text,jsonb,text,text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- (6) تعديل التقييم: يحافظ على اللقطة الأصلية (تجميد)، ويحتسب عليها
--     سياسة: العتبة = اللقطة المخزّنة إن وُجدت، وإلّا عتبة قسم الموظف الحالي، وإلّا 85.
--     أي: تعديل البنود لا يقلب التصنيف بسبب تغيّر درجة القسم لاحقًا.
--     (نفس توقيع ملف 25 حرفيًا)
-- ----------------------------------------------------------------------------
create or replace function public.admin_update_evaluation(
  p_session_token text, p_eval_id bigint, p_employee_id bigint default null, p_evaluation_date date default null,
  p_observed_issue text default null, p_observed_issue_other text default null,
  p_action_taken text default null, p_action_taken_other text default null,
  p_notes text default null, p_items jsonb default null,
  p_communication_type text default null, p_communication_reference text default null
) returns table(ok boolean, percentage numeric, grade text, message text)
language plpgsql security definer set search_path to 'public'
as $function$
declare v_sess record; v_actor text; v_eval public.evaluations; v_scores jsonb; v_call_type text;
  v_pass numeric;                                   -- ★ العتبة المجمّدة
  v_allowed constant text[] := array['admin','quality_officer'];
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,null::numeric,null::text,'انتهت الجلسة أو الرمز غير صالح'::text; return; end if;
  if not (v_sess.role = any(v_allowed)) then return query select false,null::numeric,null::text,'ليس لديك صلاحية لتعديل التقييمات'::text; return; end if;
  select * into v_eval from public.evaluations where id = p_eval_id;
  if v_eval.id is null then return query select false,null::numeric,null::text,'التقييم غير موجود'::text; return; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'object' then return query select false,null::numeric,null::text,'بيانات البنود غير صالحة'::text; return; end if;
  if p_communication_type is not null and p_communication_type not in ('chat','call') then return query select false,null::numeric,null::text,'نوع التواصل غير صالح'::text; return; end if;

  -- ★ العتبة المجمّدة: اللقطة الأصلية أولًا (سلامة تاريخية)، ثم عتبة الموظف الحالي، ثم 85
  v_pass := coalesce(
              v_eval.pass_score_snapshot,
              public.employee_pass_score(coalesce(p_employee_id, v_eval.employee_id)),
              85);

  v_scores := public.compute_evaluation_scores(p_items, v_pass);
  if v_scores ? 'error' then return query select false,null::numeric,null::text,'تعذّر احتساب الدرجة (معايير غير متوفّرة)'::text; return; end if;

  v_call_type := case when p_observed_issue = 'أخرى' then coalesce(p_observed_issue_other, p_observed_issue) else p_observed_issue end;

  update public.evaluations set
    employee_id          = coalesce(p_employee_id, employee_id),
    evaluation_date      = coalesce(p_evaluation_date, evaluation_date),
    call_type            = coalesce(v_call_type, call_type),
    observed_issue       = coalesce(p_observed_issue, observed_issue),
    observed_issue_other = coalesce(p_observed_issue_other, observed_issue_other),
    action_taken         = coalesce(p_action_taken, action_taken),
    action_taken_other   = coalesce(p_action_taken_other, action_taken_other),
    notes                = coalesce(p_notes, notes),
    communication_type   = coalesce(p_communication_type, communication_type),
    communication_reference = coalesce(nullif(trim(coalesce(p_communication_reference,'')),''), communication_reference),
    items                = p_items,
    section_scores       = v_scores->'section_scores',
    total_score          = (v_scores->>'total_score')::numeric,
    percentage           = (v_scores->>'percentage')::numeric,
    grade                = v_scores->>'grade',
    status               = v_scores->>'status',
    pass_score_snapshot  = v_pass,                  -- ★ يملأ NULL القديمة دون تغيير القيمة القائمة
    updated_at           = now()
  where id = p_eval_id;

  insert into public.notifications(id, user_id, title, message, type, entity_type, entity_id, is_read, created_at)
  values((select coalesce(max(id),0)+1 from public.notifications),
    coalesce(p_employee_id, v_eval.employee_id), 'تم تعديل تقييمك',
    'تم تعديل تقييمك — النتيجة '||(v_scores->>'percentage')||'% ('||(v_scores->>'grade')||')',
    case when (v_scores->>'status')='ناجح' then 'success' else 'warning' end, 'evaluation', p_eval_id, false, now());

  select full_name::text into v_actor from public.users where id = v_sess.user_id;
  insert into public.audit_logs(id,user_id,user_name,role,action,entity_type,entity_id,details,"timestamp")
  values((select coalesce(max(id),0)+1 from public.audit_logs), v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
    'update_evaluation','evaluation',p_eval_id,'تعديل تقييم #'||p_eval_id||' — النتيجة '||(v_scores->>'percentage')||'% ('||(v_scores->>'grade')||') عتبة '||v_pass||' — بواسطة '||coalesce(v_actor,'النظام'),now());

  return query select true, (v_scores->>'percentage')::numeric, (v_scores->>'grade')::text, 'تم تحديث التقييم'::text;
end; $function$;
revoke all on function public.admin_update_evaluation(text,bigint,bigint,date,text,text,text,text,text,jsonb,text,text) from public;
grant execute on function public.admin_update_evaluation(text,bigint,bigint,date,text,text,text,text,text,jsonb,text,text) to anon, authenticated;

commit;

-- ============================================================================
-- ملاحظات ما بعد التنفيذ (متابعة لاحقة — خارج نطاق هذا الملف):
--   (أ) العميل: توحيد gradeBadge/gradeLabel/calculateScores لتقرأ pass_score_snapshot
--       (fallback: deptPassScore ثم 85) — انظر تعديل 03-core.js المرفق للمراجعة.
--   (ب) التقييم الأسبوعي create_weekly_evaluation: يحتاج تحديثًا مماثلًا (التقاط اللقطة
--       + تخزينها) — الدالة مطبّقة على القاعدة مباشرة وغير موجودة في هذا المجلد؛
--       صفوفه ستبقى pass_score_snapshot = NULL حتى تُعالَج.
--   (ج) قياس أثر التقييمات الأسبوعية التي ستبقى بلا لقطة (NULL):
--       select count(*) from public.evaluations
--        where pass_score_snapshot is null
--          and (template_type = 'pdf_based_weekly' or week_start is not null);
--   (د) تحقّق بعد التنفيذ:
--       select id, percentage, grade, pass_score_snapshot from public.evaluations
--         order by id desc limit 20;   -- الجديدة يجب أن تعكس عتبة القسم
-- ============================================================================
