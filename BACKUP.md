# النسخ الاحتياطي والاسترجاع — Backup & Restore

نظام الجودة يخزّن كل بياناته في قاعدة **Supabase (PostgreSQL)**. لا توجد بيانات دائمة في الواجهة (المتصفّح يحتفظ بنسخة مؤقتة في `localStorage` فقط للأداء/العمل دون اتصال).

---

## 1) النسخ الاحتياطي اليومي التلقائي (موصى به)

من لوحة Supabase:
1. **Dashboard → Database → Backups**.
2. فعّل **Daily backups** (متاح في خطة Pro فأعلى؛ يحتفظ بنسخ يومية + Point-in-Time Recovery).
3. تأكّد من ظهور آخر نسخة بتاريخ اليوم.

> الخطة المجانية لا توفّر نسخاً تلقائية — استخدم النسخ اليدوي أدناه دورياً (أسبوعياً على الأقل).

## 2) نسخة احتياطية يدوية (SQL Editor)

من **Dashboard → SQL Editor**، صدّر الجداول الأساسية:
```sql
-- مثال: تصدير التقييمات كـ JSON
select json_agg(t) from public.evaluations t;
```
أو استخدم **Database → Backups → Download** لأخذ نسخة كاملة، أو `pg_dump` عبر connection string:
```bash
pg_dump "postgresql://postgres:[PASSWORD]@db.hobhajqtgcyctfmcxkel.supabase.co:5432/postgres" \
  --schema=public --no-owner -f backup_$(date +%F).sql
```

## 3) الاسترجاع (Restore)

- **PITR / Daily backup:** Dashboard → Database → Backups → اختر النسخة → **Restore**. (يستبدل البيانات الحالية — تأكّد أولاً).
- **من ملف SQL يدوي:**
  ```bash
  psql "postgresql://postgres:[PASSWORD]@db.hobhajqtgcyctfmcxkel.supabase.co:5432/postgres" -f backup_YYYY-MM-DD.sql
  ```
- بعد أي استرجاع: افتح الموقع، سجّل الدخول، وتأكّد من ظهور البيانات (الواجهة تسحب من القاعدة عند كل تنقّل).

## 4) ملفات هيكل القاعدة (Migrations)

كل تعديلات الهيكل/الدوال محفوظة في `security-migration/*.sql` بترتيب رقمي. لإعادة بناء القاعدة من الصفر، شغّلها بالترتيب في SQL Editor (انظر `security-migration/README.md`).

## 5) جدول تذكير

| المهمة | الدورية |
|---|---|
| التأكد من نجاح النسخة اليومية | يومياً |
| نسخة يدوية كاملة (إن لا يوجد Pro) | أسبوعياً |
| اختبار استرجاع على مشروع تجريبي | شهرياً |
