-- Phase A: install before deploying secure-read.js. No table access is widened.
BEGIN;
SET LOCAL lock_timeout='3s';
CREATE OR REPLACE FUNCTION public.read_scoped_data(
 p_token text,p_table text,p_filters jsonb DEFAULT '[]',p_order text DEFAULT 'id',
 p_ascending boolean DEFAULT true,p_offset integer DEFAULT 0,p_limit integer DEFAULT 1000
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s record; source_table text; scope_sql text; where_sql text:=''; f jsonb; col text; op text; result jsonb; ids bigint[]; directory_ids bigint[];
BEGIN
 SELECT * INTO s FROM public.verify_session(p_token);
 IF NOT coalesce(s.is_valid,false) OR s.role NOT IN ('admin','quality_officer','supervisor','employee') THEN
  RAISE EXCEPTION 'انتهت الجلسة' USING ERRCODE='42501';
 END IF;
 IF p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit<1 OR p_limit>1000 OR jsonb_typeof(p_filters) IS DISTINCT FROM 'array' OR jsonb_array_length(p_filters)>12 THEN RAISE EXCEPTION 'invalid_query'; END IF;
 IF p_table NOT IN ('users','users_public','evaluations','evaluation_templates','notifications','objections','creative_gene_weekly_status','creative_gene_objections','creative_gene_actions','audit_logs') OR p_table IS NULL THEN RAISE EXCEPTION 'invalid_table' USING ERRCODE='42501'; END IF;
 source_table:=CASE WHEN p_table='users' THEN 'users_public' ELSE p_table END;
 SELECT coalesce(array_agg(u.id),'{}'::bigint[]) INTO ids FROM public.users u
 WHERE s.role IN ('admin','quality_officer') OR u.id=s.user_id OR (s.role='supervisor' AND u.supervisor_id=s.user_id);
 scope_sql:='true';
 IF p_table='notifications' THEN scope_sql:=format('r.user_id=%L',s.user_id);
 ELSIF p_table='audit_logs' THEN
  IF s.role<>'admin' THEN RAISE EXCEPTION 'ليس لديك صلاحية' USING ERRCODE='42501'; END IF;
 ELSIF s.role NOT IN ('admin','quality_officer') THEN
  IF p_table IN ('users','users_public') THEN
   SELECT coalesce(array_agg(DISTINCT id),'{}'::bigint[]) INTO directory_ids FROM (
    SELECT unnest(ids) id UNION SELECT u.supervisor_id FROM public.users u WHERE u.id=ANY(ids)
    UNION SELECT e.evaluator_id FROM public.evaluations e WHERE e.employee_id=ANY(ids)
   ) x WHERE id IS NOT NULL;
   scope_sql:=format('r.id=ANY(%L::bigint[])',directory_ids);
  ELSIF p_table='evaluation_templates' THEN
   scope_sql:=format('r.department_id IN (SELECT u.department_id FROM public.users u WHERE u.id=ANY(%L::bigint[]))',ids);
  ELSE
   scope_sql:=format('r.employee_id=ANY(%L::bigint[])',ids);
  END IF;
 END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(p_filters) LOOP
  col:=f->>'column'; op:=f->>'op';
  IF col IS NULL OR col NOT IN ('id','employee_id','evaluation_id','week_start','department_id','is_active','job_role') THEN RAISE EXCEPTION 'invalid_column'; END IF;
  IF op='eq' THEN where_sql:=where_sql||format(' AND to_jsonb(r)->>%L=%L',col,f->>'value');
  ELSIF op='is' AND f->'value'='null'::jsonb THEN where_sql:=where_sql||format(' AND (to_jsonb(r)->>%L) IS NULL',col);
  ELSIF op='in' AND jsonb_typeof(f->'value')='array' AND jsonb_array_length(f->'value')<=1000 THEN
   where_sql:=where_sql||format(' AND to_jsonb(r)->>%L IN (SELECT jsonb_array_elements_text(%L::jsonb))',col,f->'value');
  ELSE RAISE EXCEPTION 'invalid_filter'; END IF;
 END LOOP;
 IF p_order IS NULL OR p_order NOT IN ('id','raised_at') THEN RAISE EXCEPTION 'invalid_order'; END IF;
 -- Directory references expose labels only; personal records remain within scope.
 IF source_table='users_public' AND s.role NOT IN ('admin','quality_officer') THEN
  EXECUTE format('SELECT coalesce(jsonb_agg(x.row),''[]'') FROM (SELECT CASE WHEN r.id=ANY($1) THEN to_jsonb(r) ELSE jsonb_build_object(''id'',r.id,''full_name'',r.full_name,''role'',r.role,''department_id'',r.department_id) END row FROM public.%I r WHERE (%s)%s ORDER BY r.%I %s OFFSET $2 LIMIT $3) x',source_table,scope_sql,where_sql,p_order,CASE WHEN p_ascending THEN 'ASC' ELSE 'DESC' END) INTO result USING ids,p_offset,p_limit;
 ELSE
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(x)),''[]'') FROM (SELECT r.* FROM public.%I r WHERE (%s)%s ORDER BY r.%I %s OFFSET $1 LIMIT $2) x',source_table,scope_sql,where_sql,p_order,CASE WHEN p_ascending THEN 'ASC' ELSE 'DESC' END) INTO result USING p_offset,p_limit;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_scoped_data(text,text,jsonb,text,boolean,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_scoped_data(text,text,jsonb,text,boolean,integer,integer) TO anon,authenticated;
COMMIT;
