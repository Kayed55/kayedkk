-- ============================================================================
-- المرحلة 7: تقوية أمنية — إزالة الصلاحيات المدمّرة عن anon/authenticated
-- ============================================================================
-- السياق:
--   مفتاح anon عام (ظاهر في الواجهة)، وكان يملك صلاحيات كاملة على كل الجداول
--   تشمل DELETE و TRUNCATE — أي يستطيع أي شخص يملك المفتاح حذف/إفراغ الجداول
--   مباشرةً عبر REST متجاوزاً التطبيق.
--
-- ما يحتاجه التطبيق فعلاً من anon:
--   - SELECT  (طبقة pull)
--   - INSERT + UPDATE  (طبقة push = upsert)
--   كل عمليات الحذف تمرّ عبر دوال RPC بـ SECURITY DEFINER (تعمل بصلاحيات المالك).
--
-- الإجراء:
--   سحب DELETE, TRUNCATE, REFERENCES, TRIGGER عن anon و authenticated من كل
--   جداول public. تبقى SELECT/INSERT/UPDATE حتى لا تتعطّل المزامنة.
--
-- ملاحظة (مخاطرة متبقّية): يبقى بإمكان anon INSERT/UPDATE (تعديل/إضافة صفوف).
--   إغلاقها الكامل يتطلب نقل كل الكتابات إلى RPCs (تقوية لاحقة — الخيار 1).
-- ============================================================================

begin;

do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format(
      'revoke delete, truncate, references, trigger on public.%I from anon, authenticated',
      t
    );
  end loop;
end $$;

commit;

-- ============================================================================
-- التحقّق بعد التشغيل:
--   1) DELETE عبر anon يجب أن يُرفض:
--      curl -X DELETE ".../rest/v1/evaluations?id=eq.999999" (anon) → خطأ صلاحية
--   2) SELECT/INSERT/UPDATE عبر anon لا تزال تعمل (المزامنة سليمة).
--   3) RPC delete_evaluation_cascade لا يزال يحذف (SECURITY DEFINER).
-- ============================================================================
