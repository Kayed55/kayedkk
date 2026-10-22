-- Phase B: apply only after deploying and verifying secure-read.js.
BEGIN;
SET LOCAL lock_timeout='3s';
-- Table-level REVOKE does not revoke column grants. Close both, including views.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT c.oid,n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') LOOP
  EXECUTE format('REVOKE SELECT ON TABLE %I.%I FROM PUBLIC, anon, authenticated',r.nspname,r.relname);
  EXECUTE (SELECT format('REVOKE SELECT (%s) ON TABLE %I.%I FROM PUBLIC, anon, authenticated',string_agg(quote_ident(attname),','),r.nspname,r.relname) FROM pg_attribute WHERE attrelid=r.oid AND attnum>0 AND NOT attisdropped);
 END LOOP;
END $$;
COMMIT;
