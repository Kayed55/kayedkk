# 🔒 السياسة الأمنية | Security Policy

## الإصدارات المدعومة

| الإصدار | الدعم الأمني |
|---------|--------------|
| 2.1.x   | ✅ مدعوم |
| 2.0.x   | ✅ مدعوم |
| < 2.0   | ❌ غير مدعوم |

---

## 🚨 الإبلاغ عن ثغرة

إذا اكتشفت ثغرة أمنية، **لا تفتح Issue عام**.

### الإبلاغ الخاص:
- 📧 راسلنا على: `security@mahzam.com`
- ⏱️ نتعهد بالرد خلال 48 ساعة
- 🔒 نعمل على الحل خلال 7-14 يوماً
- 🎖️ نقدّر مساهمتك في الحفاظ على الأمن

### معلومات يفضّل تضمينها:
1. **وصف الثغرة** + كيفية اكتشافها
2. **خطوات إعادة الإنتاج** (Proof of Concept)
3. **الأثر المحتمل** (سرقة بيانات، تعديل، إلخ)
4. **اقتراح للحل** إن وُجد

---

## ⚠️ التحذيرات الأمنية الحالية

### 1. كلمات المرور بدون تشفير
**المشكلة**: كلمات المرور في الحسابات التجريبية مخزّنة كنص واضح في `02-db.js`.

**الأثر**: يمكن لأي شخص يطّلع على الكود رؤية كلمات المرور التجريبية.

**التخفيف للإنتاج**:
```javascript
// الحل الموصى: استخدام Supabase Auth
const { user, session } = await supabase.auth.signInWithPassword({
  email, password
});

// أو bcrypt يدوي
const hashed = await bcrypt.hash(password, 10);
const valid = await bcrypt.compare(password, user.password);
```

### 2. localStorage غير مشفّر
**المشكلة**: البيانات مخزّنة في localStorage بدون تشفير.

**الأثر**: أي JavaScript يعمل على الصفحة (XSS) يمكنه قراءة البيانات.

**التخفيف**:
- استخدام Supabase backend (موصى)
- إضافة CSP headers في `vercel.json`
- Sanitize كل user input (مطبّق عبر `Utils.escape`)

### 3. RLS Policies مفتوحة
**المشكلة**: في Supabase الـ schema يستخدم `anon full access` policies.

**الأثر**: أي شخص لديه `anon key` يمكنه قراءة/تعديل كل البيانات.

**التخفيف للإنتاج**:
```sql
-- مثال: سياسة أكثر صرامة
DROP POLICY "anon_full_access_users" ON users;

CREATE POLICY "Users read own data" ON users
  FOR SELECT TO authenticated
  USING (auth.uid()::text = id::text);

CREATE POLICY "Only admins create users" ON users
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()::bigint
      AND role IN ('admin', 'quality_officer')
    )
  );
```

### 4. لا يوجد Rate Limiting
**المشكلة**: لا يوجد حد لعدد محاولات تسجيل الدخول.

**الأثر**: عرضة لـ Brute Force attacks.

**التخفيف**:
- تفعيل Vercel Web Application Firewall (Pro plan)
- استخدام Cloudflare بين Vercel والمستخدمين
- Supabase Auth يوفّر rate limiting تلقائياً

---

## ✅ الإجراءات الأمنية المطبّقة

### Frontend
- ✅ `Utils.escape()` لمنع XSS
- ✅ CSP-friendly (لا يستخدم `eval`، `Function()` ديناميكي)
- ✅ Input validation (`validateEmail`, `validatePassword`)
- ✅ Password strength enforcement
- ✅ HTTPS تلقائياً عبر Vercel

### HTTP Headers (في `vercel.json`)
- ✅ `X-Content-Type-Options: nosniff`
- ✅ `X-Frame-Options: SAMEORIGIN`
- ✅ `Referrer-Policy: strict-origin-when-cross-origin`
- ✅ `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### Audit Trail
- ✅ كل عملية تُسجَّل في `audit_logs`
- ✅ تسجيل محاولات الدخول الفاشلة
- ✅ تسجيل تغيير كلمات المرور

### Authentication
- ✅ Session via localStorage (تنتهي عند logout)
- ✅ التحقق من `is_active` عند كل دخول
- ✅ `must_change_password` flag للحسابات المعاد تعيينها

---

## 🔐 توصيات للإنتاج

### Must-Have قبل الإنتاج:

#### 1. ترقية إلى Supabase Auth
```javascript
// بدلاً من custom auth، استخدم:
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(URL, ANON_KEY)

await supabase.auth.signUp({ email, password })
await supabase.auth.signInWithPassword({ email, password })
```

**الفوائد:**
- ✅ Password hashing تلقائي
- ✅ Email verification
- ✅ Rate limiting مدمج
- ✅ Magic links + OAuth
- ✅ Session management آمن (JWT)

#### 2. شدّد RLS Policies
انتقل من `anon full access` إلى policies تعتمد على `auth.uid()`.

#### 3. أضف CSP Header
```json
// في vercel.json:
{
  "key": "Content-Security-Policy",
  "value": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co;"
}
```

#### 4. غيّر كلمات المرور التجريبية
في `supabase/seed.sql` قبل النشر، أو من الواجهة بعد النشر.

#### 5. فعّل HTTPS Strict
HTTPS مفعّل تلقائياً على Vercel. لكن أضف HSTS header:
```json
{
  "key": "Strict-Transport-Security",
  "value": "max-age=31536000; includeSubDomains; preload"
}
```

### Nice-to-Have:
- 🔵 إضافة 2FA (Supabase Auth يدعمه)
- 🔵 Email verification إجباري
- 🔵 Password expiration policy (90 يوم)
- 🔵 Account lockout بعد محاولات فاشلة
- 🔵 Audit log retention policy
- 🔵 Backup tested بشكل دوري
- 🔵 Penetration testing سنوي

---

## 🧪 اختبار الأمان

### Self-Audit Checklist
```bash
# 1. تأكد لا توجد مفاتيح مكشوفة
grep -r "password\|secret\|api[_-]key" public/ --include="*.js" | grep -v "Admin@123\|Emp@123"

# 2. تحقق من Headers
curl -I https://your-domain.vercel.app

# 3. اختبار CSP
curl -I https://your-domain.vercel.app | grep -i "content-security"

# 4. تحقق من HTTPS
curl -I http://your-domain.vercel.app  # يجب أن يعيد توجيه لـ HTTPS
```

### أدوات موصى بها:
- 🛡️ **Mozilla Observatory**: https://observatory.mozilla.org
- 🛡️ **Security Headers**: https://securityheaders.com
- 🛡️ **SSL Labs**: https://www.ssllabs.com/ssltest/
- 🛡️ **OWASP ZAP**: للاختبار العميق

---

## 📚 مراجع

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Mozilla Web Security Guidelines](https://infosec.mozilla.org/guidelines/web_security)
- [Supabase Security Best Practices](https://supabase.com/docs/guides/auth/auth-helpers)
- [Vercel Security](https://vercel.com/docs/security)

---

**🔐 الأمان مسؤولية مشتركة - شكراً لمساعدتنا في الحفاظ على أمان النظام.**

📧 `security@mahzam.com`
