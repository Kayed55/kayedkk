BEGIN;
CREATE OR REPLACE FUNCTION public.read_section_page(p_token text, p_kind text, p_offset int, p_limit int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  account record;
  allowed_ids bigint[];
  result jsonb;
BEGIN
  SELECT * INTO account FROM public.verify_session(p_token);
  IF NOT coalesce(account.is_valid,false) OR account.role IS NULL OR account.role NOT IN ('admin','quality_officer','supervisor','employee') THEN
    RAISE EXCEPTION 'انتهت الجلسة' USING ERRCODE='42501';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'invalid_pagination';
  END IF;
  IF account.role NOT IN ('admin','quality_officer') THEN
    SELECT ARRAY(SELECT u.id FROM public.users u WHERE u.id=account.user_id OR
      (account.role='supervisor' AND u.supervisor_id=account.user_id)) INTO allowed_ids;
  END IF;
  IF p_kind='evaluation_list' THEN
    SELECT coalesce(jsonb_agg(jsonb_strip_nulls(to_jsonb(r)) ORDER BY r.id),'[]') INTO result
    FROM (SELECT id,employee_id,evaluator_id,created_at,evaluation_date,total_score,percentage,
      template_type,communication_type,pass_score_snapshot,observed_issue,observed_issue_other,
      call_type,action_taken,action_taken_other,notes
      FROM public.evaluations WHERE allowed_ids IS NULL OR employee_id=ANY(allowed_ids)
      ORDER BY id OFFSET p_offset LIMIT p_limit) r;
  ELSIF p_kind='evaluations' THEN
    -- Keep every field, but send each repeated frozen rubric and answer set only once per group.
    WITH page AS (SELECT e.* FROM public.evaluations e
      WHERE allowed_ids IS NULL OR e.employee_id=ANY(allowed_ids) ORDER BY e.id OFFSET p_offset LIMIT p_limit),
    groups AS (SELECT template_snapshot,items,jsonb_agg(to_jsonb(p)-'template_snapshot'-'items' ORDER BY id) AS rows
      FROM page p GROUP BY template_snapshot,items)
    SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]') INTO result FROM groups g;
  ELSIF p_kind='objections' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') INTO result
    FROM (SELECT o.id,o.ref_number,o.evaluation_id,o.employee_id,o.reason,o.status,o.comments,o.decision,
      o.resolved_at,o.resolved_by,o.created_at,o.updated_at,o.reviewed_at,o.reviewed_by,
      (SELECT coalesce(jsonb_agg(f.file-'data' ORDER BY f.n),'[]') FROM
       jsonb_array_elements(CASE WHEN jsonb_typeof(o.attachments::jsonb)='array' THEN o.attachments::jsonb ELSE '[]' END)
       WITH ORDINALITY f(file,n)) AS attachments
      FROM public.objections o WHERE allowed_ids IS NULL OR o.employee_id=ANY(allowed_ids)
      ORDER BY o.id OFFSET p_offset LIMIT p_limit) r;
  ELSE
    RAISE EXCEPTION 'invalid_section';
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_section_page(text,text,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_section_page(text,text,int,int) TO anon,authenticated;
COMMIT;
