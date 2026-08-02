# Security Migration — Database Patches

سلسلة تصحيحات SQL لقاعدة Supabase الخاصة بنظام الجودة (شركة محزم).
تُشغَّل يدوياً من **Supabase Dashboard → SQL Editor**.

---

## الملفات الموجودة

| الملف | الغرض (جملة واحدة) |
|---|---|
| `01_stop_bleed.sql` | إيقاف تسريب البيانات الحسّاسة عبر مفتاح anon (إجراء طارئ أوّلي). |
| `01b_safe_password_protection.sql` | إنشاء `users_public` (VIEW بدون password) + `verify_login` + `change_password` وسحب `SELECT` من anon عن جدول users. |
| `01c_restore_admin_crud.sql` | استعادة صلاحيات CRUD للإدمن بعد التشديد الأمني. |
| `01d_final_admin_crud_fix.sql` | إصلاح نهائي لصلاحيات الأعمدة (column-level grants) وتعيين `default ''` لعمود password. |
| `02_otp_login.sql` | تسجيل دخول ثنائي عبر البريد (OTP): جدول `login_codes` + `request_login_code` + `verify_login_code` + `cleanup_login_codes`. |
| `02_migrate_to_auth.sql` | مخطّط/تحضير للانتقال المستقبلي إلى Supabase Auth الكامل. |
| `03_password_recovery.sql` | "نسيت كلمة المرور" + إعادة التعيين من لوحة الإدمن: `request_password_reset` + `admin_reset_password`. |
| `04_fix_reset_return_type.sql` | إصلاح خطأ `42804` بتحويل أعمدة varchar إلى `::text` في توقيعات إرجاع `request_password_reset` و `admin_reset_password` و `request_login_code`. |

---

## Rules / قواعد للمستقبل

**EN:** Any `SECURITY DEFINER` RPC returning columns from `public.users` (or any
table with `varchar` columns) **MUST** cast them explicitly in `RETURN QUERY`,
e.g. `v_user.email::text`. PostgreSQL does **NOT** auto-coerce in `RETURNS TABLE`
and will throw `42804 structure of query does not match function result type` on
the **success path only** — making the bug invisible until a real record is
fetched.

**AR:** أي دالة `SECURITY DEFINER` تُعيد أعمدة من `public.users` (أو أي جدول
يحتوي أعمدة `varchar`) **يجب** أن تستخدم `::text` صراحةً على كل عمود في جملة
`RETURN QUERY`، مثل `v_user.email::text`. PostgreSQL لا يحوّل ضمنياً في
`RETURNS TABLE` ويرمي `42804 structure of query does not match function result
type` في **مسار النجاح فقط** — مما يخفي العلّة حتى يُجلب أوّل سجلّ حقيقي.

**الأعمدة المعرّضة في جدول `users`:** `email`, `full_name`, `role`، وأي عمود من
نوع `varchar(N)`.

---

## Deployment order

تُشغَّل الملفات **بالترتيب الرقمي** في Supabase SQL Editor (ألصق محتوى كل ملف ثم
Run):

```
01_stop_bleed.sql
01b_safe_password_protection.sql
01c_restore_admin_crud.sql
01d_final_admin_crud_fix.sql
02_otp_login.sql
02_migrate_to_auth.sql        (اختياري — تحضير مستقبلي)
03_password_recovery.sql
04_fix_reset_return_type.sql
```

كل ملف مغلّف في معاملة (`begin; … commit;`)، وكل دوال RPC تُنشأ بـ
`create or replace` فآمنة لإعادة التشغيل (idempotent).

---

## ربط الموظف بالنموذج (RFC #38) — حالة الـRPCs

المرحلة 2 أضافت `users.template_id` (ملف 46) و`p_template_id` لـ:

- ✅ `create_employee` / `update_employee_profile` (ملف 47) — مسار **نموذج الموظف (ef)**.
- ✅ `create_evaluation` (ملف 48) / `create_weekly_evaluation` (ملف 49) — اختيار القالب عبر `users.template_id` مع fallback `(dept, job_role)`.

### ⚠️ desync مؤقّت — نموذج المستخدم (usr form)

نموذج **«إضافة/تعديل مستخدم»** (`showUserModal`) يستدعي `admin_create_user` /
`admin_update_user` — وهاتان **لم تُضَف لهما `p_template_id` بعد**، فما زالتا تمرّران
`p_job_role`. هذا **آمن وظيفياً**: الموظفون المُنشَؤون عبر usr form يعتمدون على
fallback `(dept, job_role)` في ملفَّي 48/49، فتقييماتهم تعمل دون `template_id`.

**TODO #46b (مؤجَّل — يُراجَع بعد Phase 5 / اختبار E2E):** إضافة `p_template_id`
لـ`admin_create_user`/`admin_update_user` (نفس نمط ملف 47: DROP+CREATE+اشتقاق) +
توحيد dropdown النماذج في usr form. **لا يُنفَّذ قبل إثبات الحاجة الفعلية**
(هل تُستخدَم usr form فعلاً لإنشاء موظفين بنماذج؟ — يُحسَم في Phase 5).

### TODO #48-ui (تنظيف واجهة — مؤجَّل، غير حرج)

بعد Phases 3-A/3-B (PRs #46/#47) بقيت بنود تجميلية/تنظيفية في `public/js/04-pages.js`:

1. **dead code:** `populateMahzamTemplates` + `loadMahzamTemplates` + `jobOpts`/`CG_JOB_ROLES`
   لم تعد مُستخدَمة في مسار ef بعد توحيد dropdown النماذج (#46). (`populateJobRole`/
   `updateJobRoleHint`/`loadJobRolesByDept` تبقى — يستخدمها usr form).
2. **بادج «النموذج المُسنَد»** في ملف الموظف (page-subtitle، admin/quality/supervisor + mahzam فقط)
   ما زال يعرض `job_role` الخام (slug) بدل تسمية بشرية — سياق admin-facing أقل حرجاً من
   عمود المسمّى الرئيسي (الذي عولج في #47).

**لا يُنفَّذ قبل Phase 5** (قد يكشف E2E مواقع UI خفية إضافية تُدمج في نفس التنظيف).
