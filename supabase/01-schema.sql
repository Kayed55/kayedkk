-- =================================================================
-- نظام محزم - الخطوة 1: إنشاء الجداول والفهارس والسياسات
-- شغّل هذا الملف أولاً ثم 02-seed.sql
-- =================================================================

-- حذف الجداول القديمة إن وجدت
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS objections CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS evaluations CASCADE;
DROP TABLE IF EXISTS criteria_config CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

-- =================================================
-- جدول المستخدمين
-- =================================================
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password TEXT NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  phone VARCHAR(20),
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin','quality_officer','supervisor','employee')),
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

-- =================================================
-- جدول معايير التقييم
-- =================================================
CREATE TABLE criteria_config (
  id BIGSERIAL PRIMARY KEY,
  config_key VARCHAR(50) UNIQUE NOT NULL,
  config_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

-- =================================================
-- جدول التقييمات
-- =================================================
CREATE TABLE evaluations (
  id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  evaluator_id BIGINT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  evaluation_date DATE NOT NULL,
  call_type VARCHAR(200),
  observed_issue VARCHAR(200),
  observed_issue_other TEXT,
  action_taken VARCHAR(200),
  action_taken_other TEXT,
  supervisor_action VARCHAR(200),
  supervisor_action_other TEXT,
  supervisor_notes TEXT,
  supervisor_action_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  supervisor_action_by_name VARCHAR(100),
  supervisor_action_at TIMESTAMPTZ,
  notes TEXT,
  items JSONB NOT NULL DEFAULT '{}'::jsonb,
  section_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_score NUMERIC(5,2) NOT NULL,
  percentage NUMERIC(5,2) NOT NULL,
  grade VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,
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

-- =================================================
-- جدول الإشعارات
-- =================================================
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

-- =================================================
-- جدول الاعتراضات
-- =================================================
CREATE TABLE objections (
  id BIGSERIAL PRIMARY KEY,
  ref_number VARCHAR(50) UNIQUE NOT NULL,
  evaluation_id BIGINT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  attachments JSONB DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','under_review','accepted','rejected')),
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

-- =================================================
-- جدول سجل العمليات
-- =================================================
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

-- =================================================
-- Triggers لتحديث updated_at
-- =================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_evaluations_updated_at BEFORE UPDATE ON evaluations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_objections_updated_at BEFORE UPDATE ON objections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =================================================
-- Row-Level Security
-- =================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE objections ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE criteria_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_full_access_users" ON users FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_full_access_evaluations" ON evaluations FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_full_access_notifications" ON notifications FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_full_access_objections" ON objections FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_full_access_audit_logs" ON audit_logs FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_full_access_criteria" ON criteria_config FOR ALL TO anon USING (true) WITH CHECK (true);

-- ✅ تم إنشاء قاعدة البيانات. شغّل الآن 02-seed.sql لإدراج البيانات الأولية.
