-- Weekly task evaluations use the end of the current week as evaluation_date.
BEGIN;
CREATE OR REPLACE FUNCTION public.guard_evaluation_date() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.evaluation_date IS NOT DISTINCT FROM OLD.evaluation_date THEN RETURN NEW; END IF;
 IF NEW.evaluation_date IS NULL OR NEW.evaluation_date < DATE '2000-01-01' OR (NEW.evaluation_date > (now() AT TIME ZONE 'Asia/Riyadh')::date AND NOT (coalesce(to_jsonb(NEW)->>'template_type','')='task_based_weekly' AND NEW.evaluation_date <= (now() AT TIME ZONE 'Asia/Riyadh')::date + 6)) THEN
  RAISE EXCEPTION 'تاريخ التقييم غير صالح؛ اختر تاريخًا بين عام 2000 واليوم' USING ERRCODE='22007';
 END IF;
 RETURN NEW;
END $$;
COMMIT;
