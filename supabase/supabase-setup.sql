-- =================================================================
-- نظام الجودة للتقييم والتدريب - شركة محزم
-- Mahzam Quality Evaluation & Training System
-- ملف الإعداد الكامل لـ Supabase (Schema + Seed)
-- =================================================================
-- طريقة الاستخدام:
-- 1. افتح Supabase Dashboard → SQL Editor → New query
-- 2. الصق هذا الملف بالكامل
-- 3. اضغط RUN (أو Ctrl+Enter)
-- 4. سيتم إنشاء كل الجداول + إدراج البيانات الأولية في خطوة واحدة
-- =================================================================

-- ===================================================================
-- القسم 1: حذف الجداول القديمة (إن وجدت) - يمنع التعارضات
-- ===================================================================
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS objections CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS evaluations CASCADE;
DROP TABLE IF EXISTS criteria_config CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;


-- ===================================================================
-- القسم 2: جدول المستخدمين
-- ===================================================================
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password TEXT NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  phone VARCHAR(20),
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'quality_officer', 'supervisor', 'employee')),
  department VARCHAR(100),
  position VARCHAR(100),
  employee_number VARCHAR(50),
  supervisor_name VARCHAR(100),
  supervisor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT TRUE,
  must_change_password BOOLEAN DEFAULT FALSE,
  password_changed_at TIMESTAMPTZ,
  password_reset_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_supervisor_id ON users(supervisor_id);
CREATE INDEX idx_users_employee_number ON users(employee_number);
CREATE INDEX idx_users_is_active ON users(is_active);


-- ===================================================================
-- القسم 3: جدول معايير التقييم
-- ===================================================================
CREATE TABLE criteria_config (
  id BIGSERIAL PRIMARY KEY,
  config_key VARCHAR(50) UNIQUE NOT NULL,
  config_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);


-- ===================================================================
-- القسم 4: جدول التقييمات
-- ===================================================================
CREATE TABLE evaluations (
  id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  evaluator_id BIGINT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  evaluation_date DATE NOT NULL,

  -- الملاحظة المرصودة
  call_type VARCHAR(200),
  observed_issue VARCHAR(200),
  observed_issue_other TEXT,

  -- الإجراء المتخذ (من قِبَل الجودة)
  action_taken VARCHAR(200),
  action_taken_other TEXT,

  -- إجراء المشرف بعد التقييم
  supervisor_action VARCHAR(200),
  supervisor_action_other TEXT,
  supervisor_notes TEXT,
  supervisor_action_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  supervisor_action_by_name VARCHAR(100),
  supervisor_action_at TIMESTAMPTZ,

  -- ملاحظات وبنود التقييم
  notes TEXT,
  items JSONB NOT NULL DEFAULT '{}'::jsonb,
  section_scores JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- النتيجة
  total_score NUMERIC(5,2) NOT NULL,
  percentage NUMERIC(5,2) NOT NULL,
  grade VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,

  -- الاعتماد
  approved BOOLEAN DEFAULT FALSE,
  approved_at TIMESTAMPTZ,
  approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_evaluations_employee_id ON evaluations(employee_id);
CREATE INDEX idx_evaluations_evaluator_id ON evaluations(evaluator_id);
CREATE INDEX idx_evaluations_date ON evaluations(evaluation_date);
CREATE INDEX idx_evaluations_approved ON evaluations(approved);
CREATE INDEX idx_evaluations_observed_issue ON evaluations(observed_issue);


-- ===================================================================
-- القسم 5: جدول الإشعارات
-- ===================================================================
CREATE TABLE notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  message TEXT,
  type VARCHAR(20) DEFAULT 'info',
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);


-- ===================================================================
-- القسم 6: جدول الاعتراضات
-- ===================================================================
CREATE TABLE objections (
  id BIGSERIAL PRIMARY KEY,
  ref_number VARCHAR(50) UNIQUE NOT NULL,
  evaluation_id BIGINT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  attachments JSONB DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'under_review', 'accepted', 'rejected')),
  comments JSONB DEFAULT '[]'::jsonb,
  decision VARCHAR(20),
  resolved_at TIMESTAMPTZ,
  resolved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_objections_employee_id ON objections(employee_id);
CREATE INDEX idx_objections_evaluation_id ON objections(evaluation_id);
CREATE INDEX idx_objections_status ON objections(status);
CREATE INDEX idx_objections_ref_number ON objections(ref_number);


-- ===================================================================
-- القسم 7: جدول سجل العمليات (Audit Log)
-- ===================================================================
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  user_name VARCHAR(100),
  role VARCHAR(20),
  action VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50),
  entity_id BIGINT,
  details TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp DESC);


-- ===================================================================
-- القسم 8: Triggers لتحديث updated_at تلقائياً
-- ===================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_evaluations_updated_at
  BEFORE UPDATE ON evaluations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_objections_updated_at
  BEFORE UPDATE ON objections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ===================================================================
-- القسم 9: Row-Level Security (RLS) Policies
-- ===================================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE objections ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE criteria_config ENABLE ROW LEVEL SECURITY;

-- سياسات الوصول عبر anon key (مناسب للـ POC)
-- للإنتاج: استبدلها بسياسات auth.uid()-based عند الانتقال إلى Supabase Auth

CREATE POLICY "anon_full_access_users"
  ON users FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_full_access_evaluations"
  ON evaluations FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_full_access_notifications"
  ON notifications FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_full_access_objections"
  ON objections FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_full_access_audit_logs"
  ON audit_logs FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "anon_full_access_criteria"
  ON criteria_config FOR ALL TO anon
  USING (true) WITH CHECK (true);


-- ===================================================================
-- القسم 10: البيانات الأولية - المستخدمون التجريبيون
-- ===================================================================
INSERT INTO users (username, email, password, full_name, phone, role, department, position, employee_number, supervisor_name, is_active, must_change_password) VALUES
('admin',      'admin@example.com',      'Admin@123',   'مدير النظام',         NULL, 'admin',           'الإدارة',     'مدير النظام',  'ADM001', '-',           TRUE, FALSE),
('qo1',        'quality@example.com',    'Quality@123', 'خالد موظف الجودة',    NULL, 'quality_officer', 'قسم الجودة', 'موظف جودة',   'QO001',  'مدير النظام', TRUE, FALSE),
('supervisor', 'supervisor@example.com', 'Super@123',   'محمد المشرف',         NULL, 'supervisor',      'قسم الجودة', 'مشرف جودة',   'SUP001', '-',           TRUE, FALSE),
('EMP001',     'emp001@example.com',     'Emp@123A!',   'أحمد علي',            NULL, 'employee',        'قسم الجودة', 'موظف خدمة',   'EMP001', 'محمد المشرف', TRUE, FALSE),
('EMP002',     'emp002@example.com',     'Emp@123A!',   'سارة محمد',           NULL, 'employee',        'قسم الجودة', 'موظف خدمة',   'EMP002', 'محمد المشرف', TRUE, FALSE),
('EMP003',     'emp003@example.com',     'Emp@123A!',   'فهد سعد',             NULL, 'employee',        'قسم الجودة', 'موظف خدمة',   'EMP003', 'محمد المشرف', TRUE, FALSE),
('EMP004',     'emp004@example.com',     'Emp@123A!',   'نورة خالد',           NULL, 'employee',        'قسم الجودة', 'موظف خدمة',   'EMP004', 'محمد المشرف', TRUE, FALSE),
('EMP005',     'emp005@example.com',     'Emp@123A!',   'عبدالله أحمد',        NULL, 'employee',        'قسم الجودة', 'موظف خدمة',   'EMP005', 'محمد المشرف', TRUE, FALSE);

-- ربط supervisor_id بالموظفين تلقائياً
UPDATE users
SET supervisor_id = (SELECT id FROM users WHERE username = 'supervisor')
WHERE role = 'employee';


-- ===================================================================
-- القسم 11: معايير التقييم الافتراضية (40 بنداً)
-- ===================================================================
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
}'::jsonb);


-- ===================================================================
-- القسم 12: التحقق من النتيجة
-- ===================================================================
-- بعد التشغيل، يجب أن ترى:
-- ✓ 6 tables created
-- ✓ 8 users inserted
-- ✓ 1 criteria record inserted

SELECT
  (SELECT COUNT(*) FROM users)            AS users_count,
  (SELECT COUNT(*) FROM criteria_config)  AS criteria_count,
  (SELECT COUNT(*) FROM evaluations)      AS evaluations_count,
  (SELECT COUNT(*) FROM notifications)    AS notifications_count,
  (SELECT COUNT(*) FROM objections)       AS objections_count,
  (SELECT COUNT(*) FROM audit_logs)       AS audit_logs_count;


-- ===================================================================
-- 🎉 تم! قاعدة البيانات جاهزة للاستخدام
-- ===================================================================
-- حسابات الدخول التجريبية:
--   المدير:        admin@example.com / Admin@123
--   موظف الجودة:   quality@example.com / Quality@123
--   المشرف:        supervisor@example.com / Super@123
--   موظف:          emp001@example.com / Emp@123A!
-- ===================================================================
-- الخطوة التالية:
-- 1. اذهب إلى Settings → API
-- 2. انسخ Project URL و anon public key
-- 3. الصقهما في ملف js/config.js
-- ===================================================================
