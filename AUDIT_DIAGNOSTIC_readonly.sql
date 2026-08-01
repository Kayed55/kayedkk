-- ============================================================================
--  حزمة تشخيص محزم — للقراءة فقط (Read-Only) — لا UPDATE/DELETE/INSERT إطلاقاً
--  الطريقة: افتح Supabase → SQL Editor. شغّل كل قسم على حدة (حدّد نص القسم ثم Run)،
--           وانسخ نتيجته (أو صدّرها CSV). ألصق النتائج لي قسمًا قسمًا.
--  ملاحظة: إن ظهر خطأ «relation does not exist» لأي قسم (cron/storage مثلاً) تجاوزه وأخبرني.
-- ============================================================================

-- == 0) مخطط الجداول الأساسية (يكشف الأعمدة الحقيقية غير الموجودة في المستودع) ==
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public'
  and table_name in ('users','departments','evaluations','objections','audit_logs',
                     'notifications','sessions','login_codes','criteria_config',
                     'evaluation_templates','creative_gene_weekly_status',
                     'creative_gene_objections','creative_gene_actions',
                     'workflow_audit_log','email_notifications_log','deleted_users_archive')
order by table_name, ordinal_position;

-- == 1) تعريفات كل الدوال/RPCs في schema public (49+) — الجوهر ==
select p.proname                                   as rpc,
       pg_get_function_identity_arguments(p.oid)   as args,
       p.prosecdef                                 as security_definer,
       p.provolatile                               as volatility,   -- v=volatile s=stable i=immutable
       pg_get_functiondef(p.oid)                   as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname;

-- == 2) صلاحيات EXECUTE على الدوال (هل anon يقدر يستدعي دوال حسّاسة؟) ==
select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema='public' and grantee in ('anon','authenticated')
order by routine_name, grantee;

-- == 3) حالة RLS لكل جدول + كل السياسات ==
select relname as table_name, relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
from pg_class
where relnamespace='public'::regnamespace and relkind='r'
order by relname;

select tablename, policyname, cmd, roles, qual as using_expr, with_check
from pg_policies where schemaname='public'
order by tablename, policyname;

-- == 4) صلاحيات الجداول لـ anon/authenticated (تأكيد تقوية 07/20 + كشف SELECT) ==
select table_name, grantee,
       string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema='public' and grantee in ('anon','authenticated')
group by table_name, grantee
order by table_name, grantee;

-- == 5) حماية أعمدة users الحسّاسة + وجود view للإخفاء ==
select table_name, column_name, grantee, privilege_type
from information_schema.column_privileges
where table_schema='public' and table_name='users' and grantee in ('anon','authenticated')
order by column_name, grantee;

select table_name as views_in_public
from information_schema.views where table_schema='public' order by 1;

-- == 6) الأقسام + pass_score + كل أعمدة department_id/pass_score عبر الجداول ==
select * from departments order by id;

select table_name, column_name, data_type
from information_schema.columns
where table_schema='public'
  and (column_name ilike '%department%' or column_name ilike '%pass_score%')
order by table_name, column_name;

-- == 7) المفاتيح الخارجية + سلوك الحذف (CASCADE/SET NULL/...) ==
select conrelid::regclass::text as table_name,
       conname as fk_name,
       pg_get_constraintdef(oid) as definition,
       case confdeltype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
            when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end as on_delete
from pg_constraint
where contype='f' and connamespace='public'::regnamespace
order by table_name, fk_name;

-- == 8) الفهارس ==
select tablename, indexname, indexdef
from pg_indexes where schemaname='public'
order by tablename, indexname;

-- == 9) الإضافات (pgcrypto لـ bcrypt / http / pg_cron) ==
select extname, extversion from pg_extension order by extname;

-- == 10) وظائف pg_cron المجدولة + آخر تشغيلاتها ==
select jobid, jobname, schedule, active, command from cron.job order by jobid;

select jobid, status, return_message, start_time, end_time
from cron.job_run_details order by start_time desc limit 20;

-- == 11) Storage: الـbuckets + سياسات storage.objects ==
select id, name, public, file_size_limit, allowed_mime_types from storage.buckets order by name;

select tablename, policyname, cmd, roles, qual as using_expr, with_check
from pg_policies where schemaname='storage'
order by tablename, policyname;

-- == 12) سلامة workflow_audit_log (عدّل أسماء الأعمدة إن اختلفت حسب القسم 0) ==
select count(*) as total_rows,
       min(created_at) as first_row, max(created_at) as last_row
from workflow_audit_log;
-- توزيع الحالات (استخدم اسم عمود الحالة الفعلي من القسم 0، غالباً to_state)
select to_state, count(*) from workflow_audit_log group by to_state order by 2 desc;

-- == 13) إحصائيات email_notifications_log (منع التكرار/الفشل) ==
select status, count(*) from email_notifications_log group by status order by 2 desc;
select * from email_notifications_log
where status = 'failed' order by created_at desc limit 20;
-- كشف تكرار محتمل (نفس الحدث لنفس الكيان أكثر من مرة)
select event_type, entity_id, count(*) as sends
from email_notifications_log
group by event_type, entity_id having count(*) > 1
order by sends desc limit 30;

-- == 14) تدقيق ثغرة إعادة التعيين: هل الدالة تُعيد كلمة المرور؟ (من تعريفها في القسم 1) ==
select proname, pg_get_functiondef(oid) as definition
from pg_proc
where proname in ('request_password_reset','admin_reset_password')
  and pronamespace='public'::regnamespace;
-- ============================================================================
--  نهاية حزمة التشخيص — كلها SELECT فقط، آمنة تماماً على الإنتاج.
-- ============================================================================
