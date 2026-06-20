# 🚀 دليل النشر | Deployment Guide

## 📋 جدول المحتويات

- [الطريقة 1: GitHub + Vercel (موصى)](#الطريقة-1-github--vercel-موصى)
- [الطريقة 2: Vercel CLI](#الطريقة-2-vercel-cli)
- [الطريقة 3: Drag & Drop](#الطريقة-3-drag--drop)
- [إعداد Supabase](#-إعداد-supabase-اختياري)
- [التحقق بعد النشر](#-التحقق-بعد-النشر)

---

## الطريقة 1: GitHub + Vercel (موصى)

### الخطوة 1: رفع على GitHub

```bash
# في مجلد المشروع
cd mahzam-quality-system

# تهيئة Git
git init
git add .
git commit -m "Initial commit: Mahzam Quality System v2.1"

# ربط بمستودع GitHub
git branch -M main
git remote add origin https://github.com/USERNAME/mahzam-quality-system.git
git push -u origin main
```

> 💡 إذا واجهتك مشكلة في الـ authentication، استخدم Personal Access Token من GitHub Settings.

### الخطوة 2: ربط Vercel

1. اذهب إلى https://vercel.com → سجّل دخول بـ GitHub
2. اضغط **"Add New Project"** (أو **"Import Project"**)
3. اختر المستودع `mahzam-quality-system`
4. اضغط **"Import"**

### الخطوة 3: إعدادات البناء

| الحقل | القيمة |
|-------|--------|
| **Framework Preset** | `Other` |
| **Root Directory** | `./` |
| **Build Command** | *(فارغ)* |
| **Output Directory** | `public` |
| **Install Command** | *(فارغ)* |

### الخطوة 4: Deploy
- اضغط **"Deploy"**
- انتظر 30 ثانية
- ستحصل على رابط مثل: `https://mahzam-quality-system.vercel.app`

### الخطوة 5: Auto-Deploy
كل `git push` للـ branch `main` يُعيد النشر تلقائياً ✅

---

## الطريقة 2: Vercel CLI

### التثبيت
```bash
npm install -g vercel
```

### النشر
```bash
cd mahzam-quality-system

# Login (مرة واحدة فقط)
vercel login

# النشر التجريبي (preview)
vercel

# النشر للإنتاج
vercel --prod
```

### الإعدادات الأولية
عند أول `vercel`، سيسأل:
- **Set up and deploy?** → `yes`
- **Which scope?** → اختر حسابك
- **Link to existing project?** → `no` (للمرة الأولى)
- **What's your project's name?** → `mahzam-quality-system`
- **In which directory is your code located?** → `./`
- **Want to modify settings?** → `no`

---

## الطريقة 3: Drag & Drop

أسرع طريقة بدون CLI أو Git:

1. اذهب إلى https://vercel.com/new
2. اسحب مجلد `public/` بالكامل إلى المنطقة المحددة
3. اضبط الاسم → اضغط **Deploy**

> ⚠️ الإصدارات اللاحقة تتطلب إعادة رفع يدوياً.

---

## 🗄️ إعداد Supabase (اختياري)

النظام يعمل **مباشرة** على localStorage بدون Supabase. لكن إذا أردت **مزامنة البيانات بين الأجهزة**، اتبع الخطوات:

### 1. إنشاء مشروع Supabase
1. زر https://supabase.com → **New Project**
2. أدخل:
   - **Name**: `mahzam-quality-system`
   - **Database Password**: كلمة مرور قوية
   - **Region**: الأقرب (مثال: Frankfurt)
3. اضغط **Create new project** (انتظر 2-3 دقائق)

### 2. تشغيل SQL Setup
- اذهب إلى **SQL Editor → New query**
- افتح `supabase/supabase-setup.sql`
- الصق المحتوى → **RUN** (Ctrl+Enter)
- النتيجة: 6 جداول + 8 مستخدمين + 40 بند تقييم

### 3. نسخ المفاتيح
- اذهب إلى **Settings → API**
- انسخ:
  - `Project URL`
  - `anon public key`

### 4. ربط النظام بـ Supabase

في `public/index.html`، أضف قبل `</body>`:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script>
  window.SUPABASE_CONFIG = {
    url: 'https://YOUR_PROJECT_ID.supabase.co',
    anonKey: 'YOUR_ANON_KEY_HERE'
  };
  window.supabaseClient = window.supabase.createClient(
    window.SUPABASE_CONFIG.url,
    window.SUPABASE_CONFIG.anonKey
  );
</script>
```

ثم عدّل `02-db.js` لاستخدام Supabase بدلاً من localStorage (راجع `supabase/README.md` للأمثلة الكاملة).

---

## ✅ التحقق بعد النشر

بعد النشر، افتح الرابط وتأكد من:

| الفحص | الحالة |
|------|--------|
| ✅ تظهر شاشة تسجيل الدخول | |
| ✅ شعار محزم يظهر بألوانه | |
| ✅ يعمل تسجيل الدخول بـ `admin@example.com / Admin@123` | |
| ✅ لوحة التحكم تظهر مع البطاقات | |
| ✅ إنشاء تقييم جديد يعمل | |
| ✅ تصدير PDF يظهر الشعار ملوّن (ليس أبيض) | |
| ✅ التقرير الشهري يظهر "التقييم النهائي العام" | |
| ✅ سجل العمليات يعمل | |
| ✅ نظام الاعتراضات يعمل | |

---

## 🛠️ استكشاف الأخطاء

### الموقع يظهر "404 NOT_FOUND"
- تأكد من أن `vercel.json` موجود في الـ root
- تأكد من أن `Output Directory` = `public` في إعدادات Vercel

### الصفحة فارغة (شاشة بيضاء)
- افتح Developer Console (F12) واقرأ الخطأ
- تأكد من تحميل جميع الـ JS modules بالترتيب
- جرّب إعادة التحميل مع Cache disabled (Ctrl+Shift+R)

### الشعار يظهر أبيض في PDF
- تحقق من إصدار النظام v2.0+ (يحتوي على inline SVG fix)
- جرّب متصفح آخر (Chrome مفضّل)

### تعديلاتي لا تظهر بعد النشر
- Vercel يخزّن cache. أضف `?v=2` لرابط الملف
- أو امسح cache المتصفح (Ctrl+Shift+Delete)
- في Vercel Dashboard: **Deployments → ... → Redeploy**

### Supabase لا يعمل
- تأكد أن RLS مفعّل (مفعّل تلقائياً في `supabase-setup.sql`)
- افتح Supabase **Logs** لمعرفة الـ queries الفاشلة
- تحقق من قيم URL و anon key

---

## 🌐 ربط Custom Domain

### في Vercel:
1. **Settings → Domains**
2. أدخل دومينك (مثال: `quality.mahzam.com`)
3. اتبع تعليمات DNS:
   - أضف `CNAME` record يشير إلى `cname.vercel-dns.com`
   - أو `A` record لـ `76.76.21.21`
4. انتظر التحقق (5-30 دقيقة)
5. Vercel يفعّل HTTPS تلقائياً ✅

---

## 🔒 الأمان للإنتاج

### قبل النشر للإنتاج:

1. **غيّر كلمات المرور التجريبية** في `supabase/seed.sql` أو في النظام
2. **شدّد RLS policies** (راجع `supabase/README.md`)
3. **استخدم Supabase Auth** بدلاً من custom auth
4. **أضف bcrypt** للـ password hashing
5. **فعّل Vercel Web Application Firewall** (Pro plan)
6. **راجع `docs/SECURITY.md`**

---

## 📊 المراقبة (Monitoring)

### Vercel Analytics
- اذهب إلى **Settings → Analytics**
- فعّل **Web Analytics** (مجاني)
- شاهد: visitors, page views, top pages

### Vercel Logs
- **Logs** في القائمة الجانبية
- شاهد: errors, console logs
- فلتر حسب الـ deployment

### Supabase Dashboard
- **Database → Logs** → استعلامات SQL
- **API → Logs** → طلبات HTTP
- **Auth → Users** → إدارة المستخدمين

---

## 💾 النسخ الاحتياطي

### Supabase
- **Settings → Database → Backups**
- النسخ التلقائية يومياً (يحتفظ Supabase بآخر 7 أيام)
- نسخة يدوية: **Database → Backups → Create backup**

### الكود
- يدوياً: `git tag v2.1.0 && git push --tags`
- تلقائياً: GitHub يحتفظ بكامل التاريخ

---

**🎉 مبروك على النشر! للأسئلة، افتح Issue على GitHub.**
