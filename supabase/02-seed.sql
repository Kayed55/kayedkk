-- =================================================================
-- نظام محزم - الخطوة 2: إدراج البيانات الأولية
-- شغّل هذا الملف بعد 01-schema.sql
-- =================================================================

-- =================================================
-- المستخدمون التجريبيون (8 حسابات)
-- =================================================
INSERT INTO users (username, email, password, full_name, phone, role, department, position, employee_number, supervisor_name, is_active, must_change_password) VALUES
('admin',      'admin@example.com',      'Admin@123',   'مدير النظام',         NULL, 'admin',           'الإدارة',     'مدير النظام',  'ADM001', '-',           TRUE, FALSE),
('qo1',        'quality@example.com',    'Quality@123', 'خالد موظف الجودة',    NULL, 'quality_officer', 'قسم الجودة', 'موظف جودة',   'QO001',  'مدير النظام', TRUE, FALSE),
('supervisor', 'supervisor@example.com', 'Super@123',   'محمد المشرف',         NULL, 'supervisor',      'قسم الجودة', 'مشرف جودة',   'SUP001', '-',           TRUE, FALSE),
('EMP001',     'emp001@example.com',     'Emp@123A!',   'أحمد علي',            NULL, 'employee',        'قسم الجودة', 'موظف خدمة',   'EMP001', 'محمد المشرف', TRUE, FALSE),
('EMP002',     'emp002@example.com',     'Emp@123A!',   'سارة محمد',           NULL, 'employee',        'قسم الجودة', 'موظف خدمة',   'EMP002', 'محمد المشرف', TRUE, FALSE),
('EMP003',     'emp003@example.com',     'Emp@123A!',   'فهد سعد',             NULL, 'employee',        'قسم الجودة', 'موظف خدمة',   'EMP003', 'محمد المشرف', TRUE, FALSE),
('EMP004',     'emp004@example.com',     'Emp@123A!',   'نورة خالد',           NULL, 'employee',        'قسم الجودة', 'موظف خدمة',   'EMP004', 'محمد المشرف', TRUE, FALSE),
('EMP005',     'emp005@example.com',     'Emp@123A!',   'عبدالله أحمد',        NULL, 'employee',        'قسم الجودة', 'موظف خدمة',   'EMP005', 'محمد المشرف', TRUE, FALSE)
ON CONFLICT (username) DO NOTHING;

-- ربط supervisor_id بالموظفين تلقائياً
UPDATE users
SET supervisor_id = (SELECT id FROM users WHERE username = 'supervisor')
WHERE role = 'employee';

-- =================================================
-- معايير التقييم الكاملة (40 بنداً في 4 أقسام)
-- =================================================
INSERT INTO criteria_config (config_key, config_value) VALUES
('criteria', '{
  "answers": {"OK": "لا يوجد خطأ", "ERR": "يوجد خطأ", "NA": "لا ينطبق"},
  "sections": [
    {
      "key": "section1",
      "title": "القسم الأول: الاحترافية والمهنية",
      "type": "non-critical",
      "weight": 30,
      "subsections": [
        {
          "title": "التعامل المهني",
          "weight": 15,
          "items": [
            {"key": "s1_1", "label": "تحية العميل بشكل مناسب"},
            {"key": "s1_2", "label": "استخدام نبرة صوت احترافية"},
            {"key": "s1_3", "label": "التعريف بالنفس وبالشركة"},
            {"key": "s1_4", "label": "الاستماع الفعّال للعميل"},
            {"key": "s1_5", "label": "استخدام لغة مهذبة"}
          ]
        },
        {
          "title": "إدارة المكالمة",
          "weight": 15,
          "items": [
            {"key": "s1_6", "label": "ضبط مسار المكالمة"},
            {"key": "s1_7", "label": "تجنب الفترات الصامتة الطويلة"},
            {"key": "s1_8", "label": "إنهاء المكالمة بشكل مناسب"},
            {"key": "s1_9", "label": "توثيق المكالمة بدقة"},
            {"key": "s1_10", "label": "احترام وقت العميل"}
          ]
        }
      ]
    },
    {
      "key": "section2",
      "title": "القسم الثاني: المعرفة بالمنتج والخدمات",
      "type": "non-critical",
      "weight": 30,
      "subsections": [
        {
          "title": "المعرفة التقنية",
          "weight": 20,
          "items": [
            {"key": "s2_1", "label": "الإلمام بتفاصيل المنتج"},
            {"key": "s2_2", "label": "شرح المزايا بوضوح"},
            {"key": "s2_3", "label": "الإجابة على الأسئلة بدقة"},
            {"key": "s2_4", "label": "تقديم حلول مناسبة"},
            {"key": "s2_5", "label": "التعامل مع الاستفسارات المعقدة"},
            {"key": "s2_6", "label": "اقتراح خدمات إضافية مناسبة"},
            {"key": "s2_7", "label": "معرفة الأسعار والعروض"}
          ]
        },
        {
          "title": "الإجراءات",
          "weight": 10,
          "items": [
            {"key": "s2_8", "label": "اتباع الإجراءات المعتمدة"},
            {"key": "s2_9", "label": "إكمال الطلبات بشكل صحيح"},
            {"key": "s2_10", "label": "متابعة الطلبات حتى الإغلاق"}
          ]
        }
      ]
    },
    {
      "key": "section3",
      "title": "القسم الثالث: جودة الخدمة",
      "type": "non-critical",
      "weight": 25,
      "subsections": [
        {
          "title": "جودة التعامل",
          "weight": 15,
          "items": [
            {"key": "s3_1", "label": "تقديم خدمة شخصية"},
            {"key": "s3_2", "label": "التعاطف مع العميل"},
            {"key": "s3_3", "label": "حل المشكلات بسرعة"},
            {"key": "s3_4", "label": "تجاوز توقعات العميل"},
            {"key": "s3_5", "label": "متابعة رضا العميل"}
          ]
        },
        {
          "title": "الكفاءة",
          "weight": 10,
          "items": [
            {"key": "s3_6", "label": "إنجاز المهام بسرعة"},
            {"key": "s3_7", "label": "تقليل الأخطاء"},
            {"key": "s3_8", "label": "استخدام الموارد بكفاءة"},
            {"key": "s3_9", "label": "إدارة الوقت"},
            {"key": "s3_10", "label": "تحقيق الأهداف اليومية"}
          ]
        }
      ]
    },
    {
      "key": "section4",
      "title": "القسم الرابع: الالتزام بالسياسات (حرج)",
      "type": "critical",
      "weight": 15,
      "subsections": [
        {
          "title": "الالتزامات الحرجة",
          "weight": 15,
          "items": [
            {"key": "s4_1", "label": "الالتزام بالسرية"},
            {"key": "s4_2", "label": "حماية بيانات العميل"},
            {"key": "s4_3", "label": "الالتزام بقواعد السلامة"},
            {"key": "s4_4", "label": "اتباع البروتوكولات الأمنية"},
            {"key": "s4_5", "label": "الإبلاغ عن المخالفات"},
            {"key": "s4_6", "label": "احترام أخلاقيات العمل"},
            {"key": "s4_7", "label": "الالتزام بساعات العمل"},
            {"key": "s4_8", "label": "تجنب تضارب المصالح"}
          ]
        }
      ]
    }
  ]
}'::jsonb)
ON CONFLICT (config_key) DO NOTHING;

-- =================================================
-- التحقق
-- =================================================
SELECT
  (SELECT COUNT(*) FROM users)            AS users_count,
  (SELECT COUNT(*) FROM criteria_config)  AS criteria_count;

-- ✅ يجب أن ترى: users_count = 8, criteria_count = 1
-- =================================================
-- حسابات الدخول التجريبية:
--   admin@example.com / Admin@123
--   quality@example.com / Quality@123
--   supervisor@example.com / Super@123
--   emp001@example.com / Emp@123A!
-- =================================================
