-- =================================================================
-- نظام محزم - استعلامات التحقق والاختبار
-- شغّل هذا الملف بعد setup للتأكد من سلامة قاعدة البيانات
-- =================================================================

-- 1. عرض جميع الجداول
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
-- المتوقع: 6 جداول (audit_logs, criteria_config, evaluations, notifications, objections, users)

-- 2. عدد الصفوف في كل جدول
SELECT
  (SELECT COUNT(*) FROM users)            AS users,
  (SELECT COUNT(*) FROM criteria_config)  AS criteria,
  (SELECT COUNT(*) FROM evaluations)      AS evaluations,
  (SELECT COUNT(*) FROM notifications)    AS notifications,
  (SELECT COUNT(*) FROM objections)       AS objections,
  (SELECT COUNT(*) FROM audit_logs)       AS audit_logs;
-- المتوقع بعد الـ seed: users=8, criteria=1, الباقي=0

-- 3. عرض المستخدمين
SELECT id, email, full_name, role, employee_number, supervisor_name, is_active
FROM users
ORDER BY id;

-- 4. اختبار البحث بالبريد (محاكاة لـ login)
SELECT id, full_name, role
FROM users
WHERE email = 'admin@example.com'
  AND password = 'Admin@123'
  AND is_active = TRUE;
-- المتوقع: صف واحد لمدير النظام

-- 5. اختبار جلب المشرفين النشطين
SELECT id, full_name, email
FROM users
WHERE role = 'supervisor' AND is_active = TRUE
ORDER BY full_name;

-- 6. اختبار جلب المعايير
SELECT
  config_value->'sections'->0->>'title' AS section_1,
  jsonb_array_length(config_value->'sections') AS sections_count,
  (
    SELECT SUM(jsonb_array_length(sub->'items'))
    FROM jsonb_array_elements(config_value->'sections') AS sec,
    jsonb_array_elements(sec->'subsections') AS sub
  ) AS total_items
FROM criteria_config
WHERE config_key = 'criteria';
-- المتوقع: 4 sections, 40 total items

-- 7. عرض الفهارس (indexes)
SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- 8. عرض السياسات (RLS Policies)
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;
-- المتوقع: 6 policies (واحدة لكل جدول)

-- 9. التأكد من تفعيل RLS
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
-- المتوقع: rowsecurity = true لكل الجداول
