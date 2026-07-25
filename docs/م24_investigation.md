# م24 — تقرير استقصاء: تعميم إدارة النماذج (Templates Management)

> **الحالة:** تقرير للمراجعة قبل التنفيذ — **لا كود بعد**.
> **التاريخ:** 2026-07-25 · **الأساس:** `main @ 8fb695e` (بعد م23 كاملةً).
> **النطاق المعتمد:** كل الأقسام (محزم + كريتف جين + مستقبلية) · تسمية عربية + إبقاء `job_role` للربط · نسخ احتياطي قبل أي DDL.

---

## أ) خارطة الوضع الحالي

### أ-1) الجداول المرتبطة
| الجدول | الأعمدة ذات الصلة | الدور |
|--------|-------------------|-------|
| **`evaluation_templates`** | `id, department_id, template_type, template_jsonb, version, is_active, job_role, updated_by, created_at, updated_at` | مصدر النماذج. القيد `uq_dept_role UNIQUE NULLS NOT DISTINCT (department_id, job_role)` |
| **`departments`** | `id, name, code, pass_score` | `code`: `mahzam` / `creative_gen` / `null` (الإدارة). عتبة النجاح على مستوى القسم |
| **`users`** | `department_id, job_role` | `job_role` يربط الموظف بنموذجه (NULL = الافتراضي) |
| **`evaluations`** | `template_snapshot (jsonb)`, `template_version (int)`, `template_type (text)` | **لقطة مُجمّدة** للنموذج وقت الإنشاء — **محميّة، لا تتأثر بأي تغيير على الجدول** |
| `creative_gene_weekly_status` | يرتبط بالتقييم | مسار CG الأسبوعي |

**قيم `template_type`:** `section_based` (محزم) · `pdf_based_weekly` (CG) · `task_based_weekly` (خامل — **لا توجد قوالب منه**).

**الحالة الفعلية للقوالب:** محزم (dept=2): قالبان (id=1 افتراضي job_role=NULL، id=35 customer_service). CG (dept=3): 10 قوالب (9 بـjob_role + 1 افتراضي). الإدارة (dept=1): لا قوالب.

### أ-2) RPCs التي تقرأ/تكتب النماذج
| RPC | الاتجاه | القسم | ملاحظة |
|-----|---------|-------|--------|
| `list_mahzam_templates(dept)` | قراءة | محزم | م23-ب |
| `create_mahzam_template(sess,dept,job_role,jsonb)` | كتابة (upsert) | محزم | م23-ب — يرفض job_role NULL |
| `set_mahzam_template_active(sess,dept,job_role,bool)` | كتابة | محزم | م23-ب — **غير مربوط بواجهة بعد** |
| `upsert_evaluation_template(sess,dept,template,type,job_role?)` | كتابة | محزم (افتراضي) + CG | القديمة — المصدر لتحرير CRITERIA وقوالب CG |
| `create_cg_template(sess,dept,job_role,payload)` | كتابة | CG | معالج CG |
| `set_cg_template_active(sess,dept,job_role,active)` | كتابة | CG | تفعيل CG |
| `delete_evaluation_template(sess,dept,job_role)` | حذف | CG | حذف قالب CG (سطور 6979/6987) |
| `list_job_roles_by_department(dept)` | قراءة | عام (CG أساساً) | يملأ قائمة المسميات |
| `get_template_for_department(sess,dept)` | قراءة | عام | جلب نموذج القسم للتقييم |
| `set_department_pass_score(...)` | كتابة | عام | عتبة النجاح (م9) |
| **قراءة داخلية عند التقييم:** `create_evaluation` (يتفرّع section/pdf ويطابق job_role) · `admin_update_evaluation` (fallback section) · `admin_update_cg_evaluation` (pdf) · `review_objection` (pdf) · `create_weekly_evaluation` (task، خامل) | قراءة | — | كلها تقرأ عبر `is_active` + مطابقة (job_role للـ pdf/section بعد م23) |

### أ-3) مواضع JS التي تعرض/تعدّل النماذج
| الدالة | الصفحة | الوظيفة |
|--------|--------|---------|
| `renderSettings` (تبويبات) | الإعدادات | form (محزم) · weights · cg · evals |
| `renderSettingsForm` + `renderMahzamTemplatesSection` | إعدادات/نموذج محزم | محرّر CRITERIA (القالب الافتراضي) + قائمة نماذج محزم + تصدير/استيراد Excel (م23-هـ) |
| `renderSettingsCg` + `cgWiz*` | إعدادات/CG | **معالج قوالب CG المتعدد** (إنشاء/تعديل/حذف/تفعيل) — الأنضج حالياً |
| `populateMahzamTemplates` / `populateJobRole` / `loadJobRolesByDept` / `loadMahzamTemplatesList` | نموذج الموظف | قوائم اختيار النموذج |
| `get_template_for_department` (استدعاء) | إنشاء تقييم | جلب النموذج الصحيح |
| `usedTemplateLabel` | عرض التقييم | تسمية النموذج المُستخدم (من snapshot) |

### أ-4) الصفحات/الأزرار
- **الإعدادات** (admin + quality_officer فقط، الحارس سطر ~6033): تبويبات النماذج.
- **إدارة الموظفين:** قائمة «النموذج» (محزم م23-ج) / «المسمى» (CG).
- **التقييمات:** تعرض النموذج المُستخدَم من اللقطة.

---

## ب) الفجوات مقابل المتطلبات الجديدة

| المتطلب | الحالة الآن | الفجوة |
|---------|-------------|--------|
| **عدد نماذج غير محدود/قسم** | CG: نعم · محزم: جزئي (م23) | توحيد الآلية لكل الأقسام |
| **تسمية عربية للنموذج** | ❌ — `job_role` (إنجليزي snake_case) يُستخدم كتسمية | **إضافة عمود `name`** |
| **تفعيل/تعطيل دون حذف** | `is_active` (bool) · محزم غير مربوط بواجهة | حالة ثلاثية + ربط UI |
| **نسخ نموذج (copy)** | ❌ | RPC + UI جديد |
| **فلترة قائمة الموظف بالقسم** | جزئي (محزم/CG منفصلان) | فلترة موحّدة بالقسم |
| **منع اختيار نموذج غير متوافق مع القسم** | ضمني (الدالة تتحقّق) لكن UI قد يعرض غير مطابق | تقييد UI + خادم |
| **منع الحذف إذا مستخدم → أرشفة** | `delete_evaluation_template` (CG) بلا فحص استخدام معروف | فحص `users.job_role` + حالة `archived` |
| **منع تكرار الاسم داخل القسم** | القيد على `(dept, job_role)` لا `name` | `UNIQUE(dept, name)` |
| **صلاحيات admin + quality_officer** | ✅ (الحارس قائم) | يبقى |
| **بطاقات: name, dept, item_count, employee_count, is_active, updated_at** | ❌ (قائمة جدول بسيطة) | عرض بطاقات + عدّادات |

---

## ج) خطة الترحيل المقترحة (5 مراحل)

| المرحلة | المحتوى | المخرَج |
|---------|---------|---------|
| **م24-ب** | DB migration + **نسخ احتياطي** (`evaluation_templates_backup_YYYYMMDD`) + إضافة `name`/`status`/قيود + backfill | ملف SQL 36 |
| **م24-ج** | واجهة إدارة النماذج (بطاقات: name/dept/counts/status) + إنشاء/تعديل/نسخ/تفعيل/أرشفة | JS |
| **م24-د** | نموذج الموظف: قائمة موحّدة **مفلترة بالقسم** + منع غير المتوافق | JS |
| **م24-هـ** | اختبارات عدم انحدار شاملة (إنشاء تقييم، snapshot، CG/محزم) | خطة اختبار |
| **م24-و** *(اختياري)* | تنظيف قاعدي: توحيد RPCs القديمة (mahzam/cg) وإزالة أعمدة مهجورة | SQL/JS |

**ترتيب حرج:** م24-ب قبل أي UI. النسخ الاحتياطي قبل أي `ALTER`.

---

## د) نموذج قاعدة البيانات المقترح

### د-1) التعديلات على `evaluation_templates`
```sql
-- (تصميم مقترح — للمراجعة، لا للتنفيذ)
ALTER TABLE public.evaluation_templates
  ADD COLUMN name   text,                                  -- تسمية عربية (عرض)
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive','archived'));

-- backfill الاسم (فريد داخل القسم): من job_role أو «الافتراضي»
UPDATE public.evaluation_templates
  SET name = coalesce(nullif(trim(job_role),''), 'النموذج الافتراضي')
  WHERE name IS NULL;

-- ثم NOT NULL + تفرّد الاسم داخل القسم
ALTER TABLE public.evaluation_templates
  ALTER COLUMN name SET NOT NULL,
  ADD CONSTRAINT unique_name_per_dept UNIQUE (department_id, name);

-- مزامنة status مع is_active التاريخي
UPDATE public.evaluation_templates SET status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END;
```

### د-2) التعامل مع `job_role` الحالي
- **يبقى** كمفتاح ربط داخلي (`users.job_role → evaluation_templates.job_role`). لا نكسر الربط القائم.
- **الفصل:** `name` = عرض · `job_role` = ربط. (لاحقاً يمكن جعل `job_role` اختيارياً وإضافة ربط صريح بـ`template_id` على users — خارج نطاق م24 المبدئي).
- **تسامح الفراغ:** `nullif(trim(job_role),'')` (مطبّق في ملف 35) يبقى.

### د-3) حماية `evaluations.template_snapshot`
- اللقطة **مُجمّدة** (نسخة jsonb كاملة وقت الإنشاء) → **لا تتأثر** بأي `ALTER`/تغيير على `evaluation_templates`. التقييمات التاريخية آمنة بالكامل. ✅
- `status='archived'` لا يمسّ اللقطات إطلاقاً.

### د-4) الانتقال `is_active` → `status`
- **مرحلة مزدوجة:** إبقاء `is_active` متزامناً مع `status` مؤقتاً (trigger أو تحديث في RPCs) حتى تُحدَّث كل قارئات `is_active` (create_evaluation، admin_update_evaluation، admin_update_cg_evaluation، review_objection، list_*). ثم إزالة `is_active` في م24-و.
- ⚠️ **قارئات `is_active` عديدة وبعضها يومي الأهمية** (create_evaluation) — يُعامَل بحذر شديد (نسخ حرفي + تعديل جراحي، كنمط ملفات 30/31/34/35).

---

## هـ) المخاطر + خطط التخفيف

| # | الخطر | التخفيف |
|---|-------|---------|
| 1 | **`ADD name NOT NULL` يفشل على صفوف موجودة** | إضافة nullable → backfill → `SET NOT NULL` (خطوات منفصلة) |
| 2 | **`UNIQUE(dept, name)` يفشل لتكرار بعد backfill** | backfill من job_role (فريد داخل القسم) + «الافتراضي» للـNULL؛ فحص تكرار قبل القيد |
| 3 | **كسر قارئات `is_active` عند التحوّل لـ`status`** | مرحلة مزدوجة (إبقاء is_active) + تعديل جراحي لكل RPC على حدة + اختبار |
| 4 | **إعادة تعريف create_evaluation (يومي) = خطر انحدار** | نسخ الجسم الحيّ حرفياً + تعديل سطر القراءة فقط + اختبار قبول قبل الدمج |
| 5 | **RPCs محزم/CG منفصلة (ازدواج)** | م24-ب يُنشئ RPCs عامة؛ الإبقاء على القديمة كـ«توجيه» مؤقت حتى م24-و |
| 6 | **فقدان بيانات عند DDL** | `evaluation_templates_backup_YYYYMMDD` + Supabase Auto Backup **قبل** أي `ALTER` |
| 7 | **الدوال الحيّة غير المتتبَّعة** (بعضها خارج المستودع) | جلب `pg_get_functiondef` قبل تعديل أي دالة غير موجودة بالمستودع (نمط ثابت في المشروع) |

---

## و) قائمة RPCs الجديدة/المُعدَّلة (مقترح — عامة لكل الأقسام)

| RPC | النوع | الوصف |
|-----|-------|-------|
| `list_templates(sess, p_dept_id)` | جديد/عام | يعمّم `list_mahzam_templates`؛ يُرجع `id, name, job_role, template_type, status, version, updated_at` + **عدّادات** (item_count من jsonb، employee_count من users) |
| `create_template(sess, dept, name, job_role, template_type, jsonb)` | جديد/عام | يعمّم create_mahzam/create_cg؛ يتحقّق `UNIQUE(dept,name)` + نوع القسم |
| `update_template(sess, id, name?, jsonb?)` | جديد | تعديل نموذج قائم (مع تفرّد الاسم) |
| `copy_template(sess, id, new_name, new_job_role?)` | جديد | نسخ نموذج داخل نفس القسم باسم/دور جديد |
| `set_template_status(sess, id, status)` | جديد | `active/inactive/archived` (يعمّم set_*_active) |
| `delete_template(sess, id)` | جديد | **يمنع الحذف إن `exists(users.job_role=...)` → يقترح الأرشفة** بدلاً منه |

**قارئات موجودة تحتاج تحديثاً** (عند التحوّل لـ`status`): `create_evaluation`, `admin_update_evaluation`, `admin_update_cg_evaluation`, `review_objection`, `get_template_for_department`, `list_job_roles_by_department` — استبدال `is_active` بـ`status='active'` **بحذر** (مرحلة مزدوجة).

---

## ملخّص القرار
- **CG أنضج** (معالج متعدد قائم) — التعميم يرفع محزم لنفس المستوى ويوحّد الآلية.
- **أخطر جزء:** التحوّل `is_active → status` لتأثيره على `create_evaluation` اليومي → مرحلة مزدوجة + اختبار صارم.
- **آمن:** `template_snapshot` يحمي كل التقييمات التاريخية.
- **الترتيب:** م24-ب (DB+backup) → ج (UI بطاقات) → د (موظف مفلتر) → هـ (اختبار) → و (تنظيف اختياري).

**التالي:** موافقتك على هذا التقرير → م24-ب (تصميم ملف SQL 36 التفصيلي + سكربت النسخ الاحتياطي) للمراجعة قبل التنفيذ.
