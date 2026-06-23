-- ============================================================================
-- إضافة حقول "نوع التواصل" لجدول evaluations
-- ============================================================================
-- evaluations فارغ حالياً → NOT NULL بقيم افتراضية مباشرة (لا backfill).
-- communication_type: 'chat' | 'call' | communication_reference: الرابط/الكود.
-- العمودان ضمن جدول مبثوث (Realtime) → يظهران لحظياً تلقائياً.
-- ============================================================================
begin;
alter table public.evaluations
  add column if not exists communication_type text not null default 'call'
    check (communication_type in ('chat','call')),
  add column if not exists communication_reference text not null default '';
commit;
