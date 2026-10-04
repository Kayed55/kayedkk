-- Apply before the new frontend. Additive API; no business data changes.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
CREATE SCHEMA IF NOT EXISTS quality_migration_private;
REVOKE ALL ON SCHEMA quality_migration_private FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS quality_migration_private.rpc_id_backup(signature text PRIMARY KEY,definition text NOT NULL);
REVOKE ALL ON quality_migration_private.rpc_id_backup FROM PUBLIC,anon,authenticated;
ALTER TABLE quality_migration_private.rpc_id_backup ENABLE ROW LEVEL SECURITY;
INSERT INTO quality_migration_private.rpc_id_backup
SELECT 'verify_session(text)',pg_get_functiondef(to_regprocedure('public.verify_session(text)'))
WHERE to_regprocedure('public.verify_session(text)') IS NOT NULL ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION public.verify_session(p_token text)
RETURNS TABLE(user_id bigint,role text,is_valid boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.sessions; u public.users;
BEGIN
 SELECT * INTO s FROM public.sessions WHERE token=p_token;
 IF s.id IS NULL OR s.expires_at<=now() THEN
  RETURN QUERY SELECT NULL::bigint,NULL::text,false; RETURN;
 END IF;
 SELECT * INTO u FROM public.users WHERE id=s.user_id;
 IF u.id IS NULL OR NOT coalesce(u.is_active,false) OR u.deleted_at IS NOT NULL THEN
  RETURN QUERY SELECT NULL::bigint,NULL::text,false; RETURN;
 END IF;
 UPDATE public.sessions SET last_used_at=now() WHERE id=s.id;
 RETURN QUERY SELECT s.user_id,u.role::text,true;
END $$;
CREATE OR REPLACE FUNCTION public.logout_session(p_token text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 DELETE FROM public.sessions WHERE token=p_token;
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.list_my_notifications(p_token text,p_offset integer DEFAULT 0,p_limit integer DEFAULT 1000)
RETURNS SETOF public.notifications LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s record;
BEGIN
 SELECT * INTO s FROM public.verify_session(p_token);
 IF NOT coalesce(s.is_valid,false) THEN RAISE EXCEPTION 'invalid_session' USING ERRCODE='42501'; END IF;
 IF p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN RAISE EXCEPTION 'invalid_pagination'; END IF;
 RETURN QUERY SELECT n.* FROM public.notifications n WHERE n.user_id=s.user_id ORDER BY n.id DESC OFFSET p_offset LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.verify_session(text),public.logout_session(text),public.list_my_notifications(text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_session(text),public.logout_session(text),public.list_my_notifications(text,integer,integer) TO anon,authenticated;
COMMIT;
