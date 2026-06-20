# Supabase Setup Guide
## دليل إعداد قاعدة بيانات Supabase

---

## 📋 الخطوات

### 1. إنشاء مشروع Supabase

1. زر [supabase.com](https://supabase.com)
2. اضغط **"New Project"**
3. املأ المعلومات:
   - **Name**: `mahzam-quality-system`
   - **Database Password**: كلمة مرور قوية (احفظها)
   - **Region**: اختر الأقرب (مثال: Frankfurt للسعودية)
4. اضغط **"Create new project"** وانتظر 2-3 دقائق

### 2. تشغيل schema.sql

افتح **SQL Editor** في لوحة Supabase والصق محتوى `schema.sql` كاملاً ثم اضغط **RUN**.

سيتم إنشاء:
- 6 جداول: `users`, `evaluations`, `notifications`, `objections`, `audit_logs`, `criteria_config`
- ~15 فهرس (indexes) للأداء
- Triggers لتحديث `updated_at` تلقائياً
- RLS policies للحماية

### 3. تشغيل seed.sql

في **SQL Editor** نفسه، الصق محتوى `seed.sql` ثم **RUN**.

سيتم إدراج:
- 8 مستخدمين تجريبيين (مدير، موظف جودة، مشرف، 5 موظفين)
- معايير التقييم الكاملة (40 بنداً)

### 4. التحقق

في **Table Editor**، تأكد من:

| الجدول | عدد الصفوف المتوقع |
|--------|--------------------|
| `users` | 8 |
| `criteria_config` | 1 |
| `evaluations` | 0 |
| `notifications` | 0 |
| `objections` | 0 |
| `audit_logs` | 0 |

### 5. نسخ مفاتيح API

اذهب إلى **Settings → API**:

- ✅ **Project URL** → استخدمه في `js/config.js` كـ `SUPABASE_URL`
- ✅ **anon public key** → استخدمه في `js/config.js` كـ `SUPABASE_ANON_KEY`

---

## 🔐 ملاحظات الأمان

### RLS (Row-Level Security)

الـ Policies الحالية في `schema.sql` تسمح بالوصول الكامل عبر مفتاح `anon`. هذا مناسب لـ:
- ✅ Proof of Concept
- ✅ تطوير داخلي
- ✅ نظام محدود الوصول

**للإنتاج**، فعّل Policies أكثر صرامة عبر `auth.uid()`.

### Service Role Key

⛔ **لا تستخدم** `service_role key` في الـ frontend!
- استخدم `anon key` فقط في الـ JS
- `service_role key` يتجاوز RLS — للسيرفر فقط

---

## 🔧 SQL مفيد

### إعادة تهيئة قاعدة البيانات
```sql
-- ⚠️ يحذف كل شيء
DROP TABLE IF EXISTS
  audit_logs, objections, notifications,
  evaluations, criteria_config, users CASCADE;
```

### تعديل كلمة مرور مستخدم
```sql
UPDATE users
SET password = 'NewPassword@2026'
WHERE email = 'admin@example.com';
```

### عرض كل التقييمات
```sql
SELECT e.id, u.full_name, e.percentage, e.grade, e.evaluation_date
FROM evaluations e
LEFT JOIN users u ON e.employee_id = u.id
ORDER BY e.evaluation_date DESC;
```

### إحصائيات سريعة
```sql
SELECT
  COUNT(*) as total_evaluations,
  ROUND(AVG(percentage), 2) as avg_score,
  COUNT(*) FILTER (WHERE status = 'ناجح') as passed,
  COUNT(*) FILTER (WHERE status = 'راسب') as failed
FROM evaluations;
```

---

## 🆘 مشاكل شائعة

### "permission denied for table users"
- تأكد من تفعيل RLS والـ Policies (تم في schema.sql)
- تحقق أن العميل يستخدم `anon key` وليس `service_role`

### "duplicate key value violates unique constraint"
- إذا شغّلت seed.sql مرتين، استخدم `ON CONFLICT DO NOTHING` (موجود بالفعل)

### بطء في الاستعلامات
- تأكد من تشغيل CREATE INDEX statements (موجودة في schema.sql)
- استخدم Supabase Dashboard → Database → Query Performance

---

## 📚 مصادر

- [Supabase Docs](https://supabase.com/docs)
- [Supabase JS Client](https://supabase.com/docs/reference/javascript)
- [PostgreSQL RLS](https://supabase.com/docs/guides/auth/row-level-security)
