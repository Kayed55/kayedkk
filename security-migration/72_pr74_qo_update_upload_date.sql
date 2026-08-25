-- ============================================================================
-- Migration 72 (Feature 1 / PR #74) — qo_update_upload_date
--   موظفة الجودة/المدير يصحّحون تاريخ رفع تقييم CG (week_start) قبل إنشاء التقييم.
-- ----------------------------------------------------------------------------
-- الحاجة: موظف كريتف جين يرفع بتاريخ خاطئ. لا مسار حالي للتصحيح — الجودة تقيّم
--   بالتاريخ الخاطئ أو ترفض وتطلب إعادة رفع. هذا RPC يسمح بتصحيح آمن ومُدقَّق.
--
-- القرارات (متّفق عليها):
--   • الخيار (أ): التعديل مسموح فقط قبل إنشاء التقييم — workflow_state='pending_quality'
--     و evaluation_id IS NULL. بعد التقييم يُرفض («التقييم مُنشأ…») لتفادي تزامن
--     جدولين (weekly_status + evaluations) + نافذة اعتراض/اعتماد قائمة.
--   • التطبيع على السبت داخل الـRPC (v_ws = تاريخ - ((dow+1)%7))؛ trigger M71
--     (BEFORE UPDATE OF week_start) يعيد التطبيع → idempotent. week_end = v_ws+6.
--   • حارس التعارض: يُرفض لو وُجد صفّ آخر لنفس الموظف عند السبت الهدف (يمنع كسر
--     القيد الفريد (employee_id, week_start)).
--   • التدقيق: wf_audit(action='date_correction', from=to='pending_quality',
--     التواريخ في notes عربي + metadata jsonb) + audit_logs عام.
--
-- عقد Anon-Only: SECURITY DEFINER + verify_session + REVOKE PUBLIC + GRANT anon.
-- هذا الملف DDL فقط (يُعرّف الدالة، لا يستدعيها) → صفر تغيير بيانات؛ counts قبل/بعد
--   لإثبات ذلك. BEGIN/COMMIT + DO $$ للتحقق الذاتي.
-- ============================================================================

BEGIN;

-- ---- counts قبل (إثبات أن الهجرة DDL-only) ---------------------------------
CREATE TEMP TABLE m72_report(phase text, tbl text, n bigint) ON COMMIT DROP;
INSERT INTO m72_report(phase, tbl, n)
SELECT 'before','creative_gene_weekly_status', count(*) FROM public.creative_gene_weekly_status
UNION ALL SELECT 'before','evaluations', count(*) FROM public.evaluations
UNION ALL SELECT 'before','audit_logs', count(*) FROM public.audit_logs
UNION ALL SELECT 'before','users', count(*) FROM public.users;

-- ---- الدالة ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.qo_update_upload_date(p_session_token text, p_weekly_status_id bigint, p_new_week_start date)
 RETURNS TABLE(ok boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sess    record;
  v_row     record;
  v_ws      date;
  v_we      date;
  v_actor   text;
  v_emp     text;
  v_allowed constant text[] := array['quality_officer','admin'];
begin
  -- (1) الجلسة
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid, false) then
    return query select false, 'انتهت الجلسة أو الرمز غير صالح'::text; return;
  end if;

  -- (2) الصلاحية — الجودة/المدير فقط (المشرف والموظف محظوران)
  if not (v_sess.role = any(v_allowed)) then
    return query select false, 'الصلاحية لموظف الجودة أو المدير فقط'::text; return;
  end if;

  if p_new_week_start is null then
    return query select false, 'التاريخ الجديد مطلوب'::text; return;
  end if;

  -- (3) الصفّ
  select id, employee_id, week_start, week_end, evaluation_id, workflow_state
    into v_row
    from public.creative_gene_weekly_status
   where id = p_weekly_status_id;
  if v_row.id is null then
    return query select false, 'طلب الرفع غير موجود'::text; return;
  end if;

  -- (4) الحارس (الخيار أ): قبل إنشاء التقييم فقط
  if v_row.evaluation_id is not null or v_row.workflow_state <> 'pending_quality' then
    return query select false, 'التقييم مُنشأ — لا يمكن تعديل التاريخ'::text; return;
  end if;

  -- (5) التطبيع على سبت الأسبوع (السبت dow=6 → إزاحة 0) + نهاية متّسقة
  v_ws := p_new_week_start - ((extract(dow from p_new_week_start)::int + 1) % 7);
  v_we := v_ws + 6;

  -- (6) لا-op
  if v_ws = v_row.week_start then
    return query select false, 'التاريخ (أسبوع السبت) نفسه بالفعل — لا تغيير'::text; return;
  end if;

  -- (7) حارس التعارض على القيد الفريد (employee_id, week_start)
  if exists(
    select 1 from public.creative_gene_weekly_status
     where employee_id = v_row.employee_id and week_start = v_ws and id <> v_row.id
  ) then
    return query select false, 'يوجد أسبوع آخر لهذا الموظف بنفس التاريخ — لا يمكن الدمج'::text; return;
  end if;

  -- (8) التحديث (trigger M71 يعيد تطبيع week_start — idempotent)
  update public.creative_gene_weekly_status
     set week_start = v_ws, week_end = v_we, updated_at = now()
   where id = v_row.id;

  -- (9) التدقيق: مسار الحالة (wf_audit) — لا انتقال حالة؛ التواريخ في notes+metadata
  select full_name::text into v_actor from public.users where id = v_sess.user_id;
  select full_name::text into v_emp   from public.users where id = v_row.employee_id;
  perform public.wf_audit(
    v_row.id, v_row.evaluation_id, 'pending_quality', 'pending_quality', 'date_correction',
    v_sess.user_id, v_sess.role,
    ('تصحيح التاريخ من '||v_row.week_start||' إلى '||v_ws)::text,
    jsonb_build_object('from_date', v_row.week_start, 'to_date', v_ws, 'normalized_to_saturday', true, 'pr', 74, 'm', 72)
  );

  -- (10) سجلّ التدقيق العام
  insert into public.audit_logs(id, user_id, user_name, role, action, entity_type, entity_id, details, "timestamp")
  values(
    (select coalesce(max(id),0)+1 from public.audit_logs),
    v_sess.user_id, coalesce(v_actor,'النظام'), v_sess.role,
    'date_correction', 'cg_weekly_status', v_row.id,
    ('تصحيح تاريخ رفع تقييم CG للموظف '||coalesce(v_emp,'-')||' من '||v_row.week_start||' إلى '||v_ws||' — بواسطة '||coalesce(v_actor,'النظام')),
    now()
  );

  return query select true, ('تم تصحيح التاريخ إلى '||v_ws)::text;
end;
$function$;

-- ---- عقد anon-only صريح ----------------------------------------------------
REVOKE ALL ON FUNCTION public.qo_update_upload_date(text, bigint, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qo_update_upload_date(text, bigint, date) TO anon, authenticated;

-- ---- counts بعد -----------------------------------------------------------
INSERT INTO m72_report(phase, tbl, n)
SELECT 'after','creative_gene_weekly_status', count(*) FROM public.creative_gene_weekly_status
UNION ALL SELECT 'after','evaluations', count(*) FROM public.evaluations
UNION ALL SELECT 'after','audit_logs', count(*) FROM public.audit_logs
UNION ALL SELECT 'after','users', count(*) FROM public.users;

-- ---- التحقق الذاتي (ذرّي) --------------------------------------------------
DO $$
DECLARE
  v_sig text := 'public.qo_update_upload_date(text, bigint, date)';
  r record;
BEGIN
  -- (أ) الدالة موجودة
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='qo_update_upload_date' AND pronamespace='public'::regnamespace) THEN
    RAISE EXCEPTION 'M72 FAILED — qo_update_upload_date غير موجودة';
  END IF;
  -- (ب) عقد anon-only: PUBLIC ممنوع · anon مسموح
  IF has_function_privilege('public', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'M72 FAILED — PUBLIC لا يزال يملك EXECUTE';
  END IF;
  IF NOT has_function_privilege('anon', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'M72 FAILED — anon لا يملك EXECUTE (التطبيق سيتعطّل)';
  END IF;
  -- (ج) DDL-only: صفر تغيير صفوف في كل الجداول
  FOR r IN
    SELECT b.tbl, b.n AS before_n, a.n AS after_n
      FROM m72_report b JOIN m72_report a ON a.tbl=b.tbl AND a.phase='after'
     WHERE b.phase='before'
  LOOP
    RAISE NOTICE 'M72 count · % : before=% after=% (Δ%)', r.tbl, r.before_n, r.after_n, (r.after_n - r.before_n);
    IF r.before_n <> r.after_n THEN
      RAISE EXCEPTION 'M72 FAILED — تغيّر عدد صفوف % (%→%) — الهجرة يجب أن تكون DDL فقط', r.tbl, r.before_n, r.after_n;
    END IF;
  END LOOP;

  RAISE NOTICE 'M72 OK — qo_update_upload_date مُعرّفة · anon-only · DDL فقط (صفر تغيير بيانات).';
END $$;

COMMIT;

-- Rollback: DROP FUNCTION IF EXISTS public.qo_update_upload_date(text, bigint, date);
