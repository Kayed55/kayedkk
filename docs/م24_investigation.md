# م24 — استقصاء إدارة النماذج

## ازدواج مسارات إنشاء النماذج (دَين تقني)

بعد م24-ج توجد **مساراتان منفصلتان** لإنشاء/تعديل نماذج التقييم، لكل منهما دوال RPC ومنطق تحقّق مختلف:

| المسار | النوع | دوال RPC | تحقّق البنية/الأوزان |
|---|---|---|---|
| **محزم / بنود** | `section_based` | `create_template` / `update_template` (SQL 37) | **خادمي** عبر `_validate_template_sections`: أوزان الأقسام=100، الفرعية داخل كل قسم=100، `type∈(critical,non-critical)`، كل بند `key+label`. |
| **CG / PDF** | `pdf_based_weekly` | `create_cg_template` (إنشاء) · `upsert_evaluation_template` (تعديل) | **عميلي فقط** (`cgWizNext`/`cgWizSave` في `04-pages.js`، السطور ~7100–7109). لا يمرّان بـ `_validate_template_sections`. |

### لماذا لم نوحّدهما في م24-ج
معالج CG يحفظ **حقولاً غنية خاصة به** (`name`, `job_title`, `job_role`, `allowed_action_types`, `objection_window_hours`, `pdf_max_size_mb`) داخل `template` كاملاً.
`create_template` الجديد يخزّن **`{criteria}` فقط** للنوع pdf — فتوحيد المعالج عليه كان **سيفقد حقول CG**. لذا أُبقي المعالج على مساره (`create_cg_template`/`upsert_evaluation_template`)، وواجهة البطاقات توجّه إليه فقط.

### المخاطر الحالية
- **تحقّق أوزان CG عميلي فقط:** الأوزان=100 مفروضة في المعالج (خطوة 2 والحفظ)، لكن **لا حاجز خادمي** في `create_cg_template`/`upsert_evaluation_template` (لم يُتحقَّق من متنهما عبر `pg_get_functiondef`). استدعاء مباشر لهاتين الدالتين خارج المعالج قد يُنشئ نموذج CG بأوزان ≠ 100.
  - **بالمقابل:** مسار `section_based` صار **محصّناً خادمياً** بعد SQL 37.
  - **إجراء مقترح (قبل الاعتماد الكامل على المسار):** مراجعة متن `create_cg_template` و`upsert_evaluation_template` عبر `pg_get_functiondef` للتأكد من وجود/غياب تحقّق الأوزان الخادمي.
- **تفرّع منطق الصيانة:** أي تغيير على قواعد النماذج (وزن، بنية، حقل جديد) يلزم تطبيقه في مكانين.

### خطة التوحيد المستقبلية (خياران)
1. **توسيع `create_template`/`update_template`** لدعم حقول CG (معامل `p_meta` مُصمَّم لهذا) بحيث يصيران المصدر الوحيد للنوعين — ثم إحالة المعالج إليهما.
2. **نقل مُحقّق الأوزان إلى المسار الخادمي لـCG:** استدعاء `_validate_template_sections('pdf_based_weekly', criteria)` داخل `create_cg_template`/`upsert_evaluation_template` — أقل تغييراً، يغلق ثغرة التحقّق الخادمي فوراً دون توحيد كامل.

> **توصية:** الخيار (2) أولاً (إغلاق ثغرة التحقّق الخادمي بأقل خطر)، ثم الخيار (1) عند الحاجة لتوحيد كامل.

راجِع أيضاً: [م24-ج-2] محرّر نماذج ديناميكي (Issue) — استبدال محرّر JSON الخام لـsection_based.
