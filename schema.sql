-- =================================================================
-- نظام الجودة للتقييم والتدريب - شركة محزم
-- Mahzam Quality Evaluation & Training System
-- Supabase Database Schema (PostgreSQL)
-- =================================================================
-- تعليمات الاستخدام:
-- 1. افتح Supabase Dashboard → SQL Editor
-- 2. الصق هذا الملف كاملاً واضغط RUN
-- 3. بعدها شغّل seed.sql لإدراج البيانات الأولية
-- =================================================================

-- ============================================
-- 1. جدول المستخدمين (Users)
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password TEXT NOT NULL, -- في الإنتاج: استخدم Supabase Auth أو bcrypt hash
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

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_supervisor_id ON users(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_users_employee_number ON users(employee_number);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

-- ============================================
-- 2. جدول معايير التقييم (Criteria)
-- ============================================
CREATE TABLE IF NOT EXISTS criteria_config (
  id BIGSERIAL PRIMARY KEY,
  config_key VARCHAR(50) UNIQUE NOT NULL,
  config_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================
-- 3. جدول التقييمات (Evaluations)
-- ============================================
CREATE TABLE IF NOT EXISTS evaluations (
  id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  evaluator_id BIGINT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  evaluation_date DATE NOT NULL,

  -- الملاحظة المرصودة
  call_type VARCHAR(200),
  observed_issue VARCHAR(200),
  observed_issue_other TEXT,

  -- الإجراء المتخذ من قِبَل الجودة
  action_taken VARCHAR(200),
  action_taken_other TEXT,

  -- إجراء المشرف (يُسجَّل لاحقاً)
  supervisor_action VARCHAR(200),
  supervisor_action_other TEXT,
  supervisor_notes TEXT,
  supervisor_action_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  supervisor_action_by_name VARCHAR(100),
  supervisor_action_at TIMESTAMPTZ,

  -- ملاحظات إضافية
  notes TEXT,

  -- بنود التقييم (JSONB)
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

CREATE INDEX IF NOT EXISTS idx_evaluations_employee_id ON evaluations(employee_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_evaluator_id ON evaluations(evaluator_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_date ON evaluations(evaluation_date);
CREATE INDEX IF NOT EXISTS idx_evaluations_approved ON evaluations(approved);
CREATE INDEX IF NOT EXISTS idx_evaluations_observed_issue ON evaluations(observed_issue);

-- ============================================
-- 4. جدول الإشعارات (Notifications)
-- ============================================
CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  message TEXT,
  type VARCHAR(20) DEFAULT 'info',
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);

-- ============================================
-- 5. جدول الاعتراضات (Objections)
-- ============================================
CREATE TABLE IF NOT EXISTS objections (
  id BIGSERIAL PRIMARY KEY,
  ref_number VARCHAR(50) UNIQUE NOT NULL,
  evaluation_id BIGINT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  attachments JSONB DEFAULT '[]'::jsonb, -- [{name, type, size, data (base64)}]
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'under_review', 'accepted', 'rejected')),
  comments JSONB DEFAULT '[]'::jsonb, -- [{user_id, user_name, role, text, created_at, is_resolution}]
  decision VARCHAR(20),
  resolved_at TIMESTAMPTZ,
  resolved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_objections_employee_id ON objections(employee_id);
CREATE INDEX IF NOT EXISTS idx_objections_evaluation_id ON objections(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_objections_status ON objections(status);
CREATE INDEX IF NOT EXISTS idx_objections_ref_number ON objections(ref_number);

-- ============================================
-- 6. جدول سجل العمليات (Audit Log)
-- ============================================
CREATE TABLE IF NOT EXISTS audit_logs (
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

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);

-- ============================================
-- 7. دالة تحديث updated_at تلقائياً
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_evaluations_updated_at ON evaluations;
CREATE TRIGGER update_evaluations_updated_at
  BEFORE UPDATE ON evaluations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_objections_updated_at ON objections;
CREATE TRIGGER update_objections_updated_at
  BEFORE UPDATE ON objections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 8. Row-Level Security (RLS) Policies
-- ============================================
-- ملاحظة مهمة: المشروع يستخدم anon key + custom auth في الـ frontend
-- إذا كنت تستخدم Supabase Auth، فعّل RLS وأضف سياسات أكثر صرامة
-- للبيئة التطوير الحالية، نسمح بالوصول الكامل عبر anon key

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE objections ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE criteria_config ENABLE ROW LEVEL SECURITY;

-- سياسة الوصول الكامل عبر anon key (مناسبة لـ POC)
-- للإنتاج: استخدم Supabase Auth وسياسات تعتمد على auth.uid()

DROP POLICY IF EXISTS "Allow anon full access on users" ON users;
CREATE POLICY "Allow anon full access on users" ON users
  FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon full access on evaluations" ON evaluations;
CREATE POLICY "Allow anon full access on evaluations" ON evaluations
  FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon full access on notifications" ON notifications;
CREATE POLICY "Allow anon full access on notifications" ON notifications
  FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon full access on objections" ON objections;
CREATE POLICY "Allow anon full access on objections" ON objections
  FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon full access on audit_logs" ON audit_logs;
CREATE POLICY "Allow anon full access on audit_logs" ON audit_logs
  FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon full access on criteria_config" ON criteria_config;
CREATE POLICY "Allow anon full access on criteria_config" ON criteria_config
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- ============================================
-- نهاية الـ schema
-- ============================================
-- لإلغاء كل شيء (للاختبار):
-- DROP TABLE IF EXISTS audit_logs, objections, notifications, evaluations, criteria_config, users CASCADE;
