-- ============================================================================
-- Migration 57 (PR #70) — raise_objection: نافذة اعتراض 24h من تقييم الجودة (D3/D4)
-- الأساس: الجسم الحرفي من الإنتاج (CSV 2026-08-06) + 3 تعديلات نقطية:
--   ① شرط الحالة: <> 'approved'  →  NOT IN ('pending_supervisor','approved')  (الموظف يعترض بغض النظر عن تصرّف المشرف)
--   ② الرسالة: "48 ساعة من الاعتماد"  →  "24 ساعة من تقييم الجودة"
--   ③ wf_audit from_state: حرفي 'approved'  →  v_wf (الحالة الفعلية)
-- الباقي (notifications للجودة+المشرف، UNIQUE guard، audit) verbatim. grants محفوظة (CREATE OR REPLACE).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.raise_objection(p_session_token text, p_evaluation_id bigint, p_objection_text text)
 RETURNS TABLE(ok boolean, objection_id bigint, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sess record; v_eval public.evaluations; v_win int; v_deadline timestamptz; v_id bigint; v_sup bigint; v_emp text; v_wf text; v_status_id bigint;
begin
  select * into v_sess from public.verify_session(p_session_token);
  if not coalesce(v_sess.is_valid,false) then return query select false,null::bigint,'انتهت الجلسة'::text; return; end if;
  if v_sess.role <> 'employee' then return query select false,null::bigint,'الاعتراض متاح للموظف فقط'::text; return; end if;
  select * into v_eval from public.evaluations where id = p_evaluation_id;
  if v_eval.id is null then return query select false,null::bigint,'التقييم غير موجود'::text; return; end if;
  if v_eval.template_type <> 'pdf_based_weekly' then return query select false,null::bigint,'الاعتراض متاح لتقييمات Creative Gene فقط'::text; return; end if;
  if v_eval.employee_id <> v_sess.user_id then return query select false,null::bigint,'يمكنك الاعتراض على تقييمك فقط'::text; return; end if;
  if coalesce(trim(p_objection_text),'') = '' then return query select false,null::bigint,'نص الاعتراض مطلوب'::text; return; end if;
  select workflow_state, objection_deadline into v_wf, v_deadline from public.creative_gene_weekly_status where evaluation_id = p_evaluation_id;
  if coalesce(v_wf,'') not in ('pending_supervisor','approved') then return query select false,null::bigint,'الاعتراض غير متاح في الحالة الحالية للتقييم'::text; return; end if;  -- ★ #70 D4
  if v_deadline is null or now() >= v_deadline then return query select false,null::bigint,'انتهت مهلة الاعتراض (24 ساعة من تقييم الجودة)'::text; return; end if;  -- ★ #70
  begin
    insert into public.creative_gene_objections(evaluation_id, employee_id, objection_text)
    values(p_evaluation_id, v_sess.user_id, trim(p_objection_text)) returning id into v_id;
  exception when unique_violation then return query select false,null::bigint,'سبق تقديم اعتراض على هذا التقييم'::text; return; end;
  update public.creative_gene_weekly_status set status='objection_raised', workflow_state='objection_raised', updated_at=now() where evaluation_id = p_evaluation_id returning id into v_status_id;
  perform public.wf_audit(v_status_id, p_evaluation_id, v_wf, 'objection_raised', 'objection', v_sess.user_id, v_sess.role, trim(p_objection_text), '{}'::jsonb);  -- ★ #70 from_state = v_wf
  select full_name::text into v_emp from public.users where id = v_sess.user_id;
  select supervisor_id into v_sup from public.users where id = v_sess.user_id;
  insert into public.notifications(id,user_id,title,message,type,entity_type,entity_id,is_read,created_at)
  select (select coalesce(max(id),0) from public.notifications) + row_number() over(), u.id, 'اعتراض جديد - Creative Gene',
    'قدّم '||coalesce(v_emp,'موظف')||' اعتراضاً على تقييمه', 'warning','evaluation',p_evaluation_id,false,now()
  from public.users u where u.role='quality_officer' and coalesce(u.is_active,true);
  if v_sup is not null then
    insert into public.notifications(id,user_id,title,message,type,entity_type,entity_id,is_read,created_at)
    values((select coalesce(max(id),0)+1 from public.notifications), v_sup, 'اعتراض جديد - Creative Gene', 'قدّم '||coalesce(v_emp,'موظف')||' اعتراضاً على تقييمه', 'warning','evaluation',p_evaluation_id,false,now());
  end if;
  return query select true, v_id, 'تم تقديم الاعتراض'::text;
end; $function$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='raise_objection' AND pronamespace='public'::regnamespace) THEN
    RAISE EXCEPTION 'Migration 57 failed — raise_objection missing';
  END IF;
  RAISE NOTICE 'Migration 57 OK — raise_objection window = pending_supervisor|approved, 24h';
END $$;

COMMIT;

-- Rollback: أعد تطبيق الجسم الحرفي الأصلي من CSV/الإنتاج (شرط <> 'approved' + رسالة 48h + from_state 'approved').
