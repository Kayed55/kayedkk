# قاعدة بيانات نظام محزم - جاهزة لـ Supabase

## 📦 الملفات

| الملف | الوصف | الاستخدام |
|------|-------|----------|
| **`supabase-setup.sql`** ⭐ | كل شيء في ملف واحد (Schema + Seed + Verification) | **الأسرع - موصى به** |
| `01-schema.sql` | فقط إنشاء الجداول | اختياري - للفصل |
| `02-seed.sql` | فقط البيانات الأولية | اختياري - للفصل |
| `verify.sql` | استعلامات التحقق | بعد الإعداد للتأكد |

---

## 🚀 الطريقة الأسرع (دقيقة واحدة)

### 1. افتح Supabase
- اذهب إلى https://supabase.com
- اختر مشروعك (أو أنشئ مشروعاً جديداً)
- من القائمة الجانبية: **SQL Editor**

### 2. الصق وشغّل
- اضغط **"New query"**
- افتح ملف **`supabase-setup.sql`** ⭐
- انسخ كل المحتوى
- الصقه في SQL Editor
- اضغط **RUN** (أو Ctrl+Enter)

### 3. تحقق من النتيجة
في الأسفل ستظهر:
```
users_count | criteria_count | evaluations_count | ...
     8      |       1        |        0          | ...
```

✅ **تم!** قاعدة البيانات جاهزة.

---

## 🔑 خطوة أخيرة - نسخ المفاتيح

1. في Supabase: **Settings → API**
2. انسخ القيمتين:
   - `Project URL` ← مثل: `https://abc123.supabase.co`
   - `anon public key` ← مثل: `eyJhbGciOiJIUzI1NiI...`
3. الصقهما في ملف `js/config.js` في مشروعك:

```javascript
window.AppConfig = {
  SUPABASE_URL: 'https://abc123.supabase.co',         // ← هنا
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiI...',        // ← هنا
  // ...
};
```

---

## 📊 ما الذي تم إنشاؤه؟

### 6 جداول:
- `users` - المستخدمون (مدير، موظف جودة، مشرف، موظف)
- `evaluations` - التقييمات + بنود + إجراءات
- `notifications` - الإشعارات
- `objections` - الاعتراضات + التعليقات
- `audit_logs` - سجل العمليات
- `criteria_config` - معايير التقييم (40 بنداً)

### 20+ فهرس (Index) للأداء
- على البريد، الدور، رقم المشرف، إلخ

### 6 سياسات أمان (RLS)
- تسمح بالوصول الكامل عبر `anon key` (مناسب للبداية)

### 8 مستخدمين تجريبيين:

| الدور | البريد | كلمة المرور |
|------|--------|-------------|
| 👑 مدير النظام | `admin@example.com` | `Admin@123` |
| ⚖️ موظف الجودة | `quality@example.com` | `Quality@123` |
| 👨‍💼 مشرف | `supervisor@example.com` | `Super@123` |
| 👤 موظف 1 | `emp001@example.com` | `Emp@123A!` |
| 👤 موظف 2 | `emp002@example.com` | `Emp@123A!` |
| 👤 موظف 3 | `emp003@example.com` | `Emp@123A!` |
| 👤 موظف 4 | `emp004@example.com` | `Emp@123A!` |
| 👤 موظف 5 | `emp005@example.com` | `Emp@123A!` |

### معايير التقييم (40 بنداً):
- **القسم 1**: الاحترافية والمهنية (30 نقطة) - 10 بنود
- **القسم 2**: المعرفة بالمنتج (30 نقطة) - 10 بنود
- **القسم 3**: جودة الخدمة (25 نقطة) - 10 بنود
- **القسم 4**: الالتزام بالسياسات حرج (15 نقطة) - 10 بنود

---

## ✅ التحقق

شغّل `verify.sql` للتأكد:
- ✅ 6 جداول
- ✅ 20+ فهرس
- ✅ 6 سياسات RLS مفعّلة
- ✅ 8 مستخدمين
- ✅ 40 بند تقييم

---

## ⚠️ ملاحظات أمنية

كلمات المرور حالياً مخزّنة بدون تشفير (للـ POC).

**للإنتاج:**
- استخدم Supabase Auth بدلاً من custom users table
- أو ضِف bcrypt hash لكلمات المرور
- شدّد سياسات RLS لتعتمد على `auth.uid()`

التفاصيل في README الرئيسي للمشروع.

---

## 🆘 مشاكل شائعة

### `relation "users" does not exist`
- تأكد أنك شغّلت `supabase-setup.sql` كاملاً (ليس جزءاً منه)

### `duplicate key value violates unique constraint`
- شغّلت SQL مرتين. لا مشكلة - الـ `ON CONFLICT DO NOTHING` يتجاهل التكرار

### `permission denied for table users`
- تأكد أن RLS مفعّل والسياسات موجودة (تحقق بـ `verify.sql`)

### تريد البدء من الصفر
شغّل في SQL Editor:
```sql
DROP TABLE IF EXISTS audit_logs, objections, notifications, evaluations, criteria_config, users CASCADE;
```
ثم أعد تشغيل `supabase-setup.sql`.
