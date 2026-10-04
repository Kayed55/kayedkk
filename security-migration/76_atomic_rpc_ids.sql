-- Review live function definitions first. Captures originals for recovery.
-- Replaces only exact MAX(id)+1 allocators for the five verified tables.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
CREATE SCHEMA IF NOT EXISTS quality_migration_private;
REVOKE ALL ON SCHEMA quality_migration_private FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS quality_migration_private.rpc_id_backup(signature text PRIMARY KEY,definition text NOT NULL);
REVOKE ALL ON quality_migration_private.rpc_id_backup FROM PUBLIC,anon,authenticated;
ALTER TABLE quality_migration_private.rpc_id_backup ENABLE ROW LEVEL SECURITY;
LOCK TABLE public.audit_logs,public.evaluations,public.notifications,public.objections,public.users IN ACCESS EXCLUSIVE MODE;
DO $migration$
DECLARE t text; seq text; high bigint; current_high bigint; f record; def text; old_def text; pattern text;
BEGIN
 FOREACH t IN ARRAY ARRAY['audit_logs','evaluations','notifications','objections','users'] LOOP
  seq:=pg_get_serial_sequence('public.'||t,'id');
  IF seq IS NULL THEN
   seq:='public.quality_'||t||'_id_seq';
   EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %s AS bigint',seq::text);
   EXECUTE format('ALTER SEQUENCE %s OWNED BY public.%I.id',seq,t);
   EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC,anon,authenticated',seq);
  END IF;
  EXECUTE format('SELECT coalesce(max(id),0) FROM public.%I',t) INTO high;
  EXECUTE format('SELECT last_value FROM %s',seq::regclass) INTO current_high;
  PERFORM setval(seq::regclass,greatest(high,current_high,1),true);
  EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT nextval(%L::regclass)',t,seq);
 END LOOP;
 FOR f IN SELECT p.oid,p.oid::regprocedure::text AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' LOOP
  old_def:=pg_get_functiondef(f.oid); def:=old_def;
  FOREACH t IN ARRAY ARRAY['audit_logs','evaluations','notifications','objections','users'] LOOP
   pattern:='select\s+coalesce\(\s*max\(\s*id\s*\)\s*,\s*0\s*\)\s*\+\s*1\s+from\s+public\.'||t||'\M';
   def:=regexp_replace(def,pattern,format('nextval(%L::regclass)',pg_get_serial_sequence('public.'||t,'id')),'gi');
   pattern:='\(select\s+coalesce\(max\(id\),0\)\s+from\s+public\.'||t||'\)\s*\+\s*row_number\(\)\s+over\(\)';
   def:=regexp_replace(def,pattern,format('nextval(%L::regclass)',pg_get_serial_sequence('public.'||t,'id')),'gi');
  END LOOP;
  IF def<>old_def THEN
   INSERT INTO quality_migration_private.rpc_id_backup VALUES(f.signature,old_def) ON CONFLICT DO NOTHING;
   EXECUTE def;
  END IF;
 END LOOP;
END $migration$;
COMMIT;
