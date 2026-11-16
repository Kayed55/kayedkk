-- Preserve deployed signatures, authorization, ownership and grants. Re-runnable.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $migration$
DECLARE source text;
BEGIN
  source := pg_get_functiondef('public.read_scoped_data(text,text,jsonb,text,boolean,integer,integer)'::regprocedure);
  source := replace(source, $old$format(' AND to_jsonb(r)->>%L=%L',col,f->>'value')$old$, $new$format(' AND r.%I=%L',col,f->>'value')$new$);
  source := replace(source, $old$format(' AND (to_jsonb(r)->>%L) IS NULL',col)$old$, $new$format(' AND r.%I IS NULL',col)$new$);
  source := replace(source, $old$where_sql:=where_sql||format(' AND to_jsonb(r)->>%L IN (SELECT jsonb_array_elements_text(%L::jsonb))',col,f->'value');$old$,
    $new$where_sql:=where_sql||CASE WHEN jsonb_array_length(f->'value')=0 THEN ' AND false' ELSE format(' AND r.%I IN (%s)',col,(SELECT string_agg(quote_nullable(v),',') FROM jsonb_array_elements_text(f->'value') AS t(v))) END;$new$);
  IF source LIKE '%AND to_jsonb(r)%' OR source NOT LIKE '%AND r.%I=%L%' THEN RAISE EXCEPTION 'unexpected scoped read definition'; END IF;
  EXECUTE source;

  source := pg_get_functiondef('public.read_section_page(text,text,integer,integer)'::regprocedure);
  source := replace(source, $old$ELSIF p_kind='evaluations' THEN$old$, $new$ELSIF p_kind IN ('evaluations','cg_evaluations') THEN$new$);
  source := replace(source, $old$WHERE allowed_ids IS NULL OR e.employee_id=ANY(allowed_ids) ORDER BY e.id$old$,
    $new$WHERE (allowed_ids IS NULL OR e.employee_id=ANY(allowed_ids)) AND (p_kind='evaluations' OR e.template_type IN ('pdf_based_weekly','task_based_weekly')) ORDER BY e.id$new$);
  source := replace(source, $old$call_type,action_taken,action_taken_other,notes
      FROM$old$, $new$call_type,action_taken,action_taken_other,notes,week_start,week_end,supervisor_action,supervisor_action_other,
      supervisor_notes,supervisor_action_at,supervisor_action_by_name,approved,approved_at,approved_by
      FROM$new$);
  IF source NOT LIKE '%cg_evaluations%' OR source NOT LIKE '%supervisor_action_by_name%' OR source NOT LIKE '%p_kind=''evaluations'' OR e.template_type%' THEN RAISE EXCEPTION 'unexpected section read definition'; END IF;
  EXECUTE source;
END
$migration$;
COMMIT;
