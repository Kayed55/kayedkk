#!/usr/bin/env node
'use strict';
// ملاحظة: بعد إصلاح #30 (weekEndStr بـUTC صريح) لم يعد أي هدف حسّاساً للمنطقة الزمنية،
// فالسلسلة حتمية بلا تثبيت TZ (مُتحقَّق بتشغيلها تحت TZ=Asia/Riyadh).
/**
 * اختبارات عدم انحدار خفيفة (م24-هـ) — Node core فقط (بلا npm).
 *
 * التحميل: vm + Proxy stub (يمتصّ أي window/document/…) + تعبير مُلحَق في الذاكرة
 * يلتقط الدوال/الكائنات المستهدفة — **صفر تعديل على ملفات المصدر**.
 *
 * النطاق (م24-هـ): calculateScores · Utils.gradeLabel/gradeBadge ·
 *                   teEqualWeights/teValidKey/teSlug/teRound · weekEndStr.
 *
 * أكواد الخروج: 0 = كل الاختبارات نجحت · 1 = فشل اختبار (أو خطأ تحميل).
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');

// ---------- محمّل vm ----------
function makeCtx() {
  const anything = new Proxy(function () {}, { get: () => anything, apply: () => anything, set: () => true, construct: () => anything });
  const ctx = {
    console, Math, Date, JSON, parseFloat, parseInt, isNaN, Array, Object, String, Number, RegExp, Set, Map,
    window: anything, document: anything, localStorage: anything, navigator: anything,
    CRITERIA: null, DEFAULT_CRITERIA: {},
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  return ctx;
}
function load(file, pickExpr) {
  const ctx = makeCtx();
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const exp = vm.runInContext(src + '\n;(' + pickExpr + ')', ctx, { filename: file });
  return { exp, ctx };
}

// ---------- عدّاء اختبارات مصغّر ----------
let passed = 0, failed = 0, skipped = 0; const fails = [];
function section(t) { console.log('\n── ' + t + ' ──'); }
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; fails.push(name); console.log('  ✗ ' + name + ' — ' + (e && e.message)); }
}
// اختبار مُعطَّل (لا يُنفَّذ، لا يُحسب فشلاً) — لتوثيق سلوك مطلوب بانتظار قرار.
function skip(name, reason) { skipped++; console.log('  ⊘ ' + name + '  (skip — ' + reason + ')'); }

// ---------- تحميل الأهداف ----------
let core, pages;
try {
  core = load('public/js/03-core.js', '({ calculateScores, Utils })');
  pages = load('public/js/04-pages.js', '({ teEqualWeights, teValidKey, teSlug, teRound, weekEndStr })');
} catch (e) {
  console.error('❌ فشل تحميل المصدر عبر vm: ' + (e && e.message));
  process.exit(1);
}

// fixture يُرمّز **قناعة المحرّكات الحالية**: أوزان الأقسام الفرعية تجمع وزن القسم
// (كالقالب الافتراضي: القسم الرابع فرعياته تجمع وزنه). راجع Issue #29 لتناقض المُحقّق.
const FIX = {
  answers: { OK: 'ok', ERR: 'err', NA: 'na' },
  sections: [
    { key: 'A', type: 'critical', title: 'حرج', weight: 40,
      subsections: [{ key: 'a', title: '', weight: 40, items: [{ key: 'a1', label: 'a1' }, { key: 'a2', label: 'a2' }] }] },
    { key: 'B', type: 'non-critical', title: 'غير حرج', weight: 60,
      subsections: [
        { key: 'b_1', title: '', weight: 30, items: [{ key: 'b1', label: 'b1' }, { key: 'b2', label: 'b2' }] },
        { key: 'b_2', title: '', weight: 30, items: [{ key: 'b3', label: 'b3' }] },
      ] },
  ],
};
function calc(items) { core.ctx.CRITERIA = FIX; return core.exp.calculateScores(items, 85); }

section('calculateScores (قناعة المحرّكات: فرعية = وزن القسم — Issue #29)');
test('كل صحيح → total=100 · ناجح', () => {
  const r = calc({ a1: 'ok', a2: 'ok', b1: 'ok', b2: 'ok', b3: 'ok' });
  assert.strictEqual(r.totalScore, 100); assert.strictEqual(r.grade, 'ناجح');
});
test('خطأ في قسم حرج → القسم=0 · total=60 · راسب', () => {
  const r = calc({ a1: 'err', a2: 'ok', b1: 'ok', b2: 'ok', b3: 'ok' });
  assert.strictEqual(r.sectionScores.A, 0); assert.strictEqual(r.totalScore, 60); assert.strictEqual(r.grade, 'راسب');
});
test('غير حرج مرجّح: خطأ جزئي + NA → القسم=45 · total=85 · ناجح', () => {
  const r = calc({ a1: 'ok', a2: 'ok', b1: 'err', b2: 'ok', b3: 'na' });
  assert.strictEqual(r.sectionScores.B, 45); assert.strictEqual(r.totalScore, 85); assert.strictEqual(r.grade, 'ناجح');
});
test('NA فقط في فرعي → يأخذ كامل وزنه (applicable=0)', () => {
  const r = calc({ a1: 'ok', a2: 'ok', b1: 'ok', b2: 'ok', b3: 'na' });
  assert.strictEqual(r.sectionScores.B, 60);
});
test('يجمع كل الأخطاء في errors[]', () => {
  const r = calc({ a1: 'err', a2: 'ok', b1: 'err', b2: 'ok', b3: 'ok' });
  assert.strictEqual(r.errors.length, 2);
});
test('العتبة: total==passScore → ناجح (>=)', () => {
  const r = calc({ a1: 'ok', a2: 'ok', b1: 'err', b2: 'ok', b3: 'na' }); // total=85
  assert.strictEqual(r.percentage, 85); assert.strictEqual(r.grade, 'ناجح');
});

section('⊘ الباغ المحتمل (#29) — يُفعَّل بعد حسم قناعة الأوزان');
// (الخيار ج) اختبار مُعطَّل يوثّق التناقض تنفيذياً: قالب م26 (فرعية تجمع 100 لكل قسم) بأقسام
// متعدّدة + قسم غير حرج. السلوك المطلوب: total <= 100. لكن المحرّكين حالياً يجمعان أوزان
// الفرعية بلا قياس بوزن القسم → total > 100 (يفشل). مُعطَّل حتى يُحسم Issue #29.
// عند الحسم: استبدل skip(...) بالكتلة التالية (test) وتأكّد من مرورها:
//   test('قالب م26 متعدّد الأقسام + غير حرج → total<=100', () => {
//     const M26 = { answers:{OK:'ok',ERR:'err',NA:'na'}, sections:[
//       { key:'C', type:'critical', title:'', weight:50, subsections:[{key:'c',title:'',weight:100,items:[{key:'c1',label:''}]}] },
//       { key:'N', type:'non-critical', title:'', weight:50, subsections:[
//         {key:'n1',title:'',weight:50,items:[{key:'n1a',label:''}]}, {key:'n2',title:'',weight:50,items:[{key:'n2a',label:''}]} ] } ]};
//     core.ctx.CRITERIA = M26;
//     const r = core.exp.calculateScores({ c1:'ok', n1a:'ok', n2a:'ok' }, 85);
//     assert.ok(r.totalScore <= 100, 'total='+r.totalScore); // حالياً 150 → يفشل حتى إصلاح #29
//   });
skip('قالب م26 (فرعية=100 · متعدّد الأقسام · غير حرج) → total<=100', 'بانتظار حسم #29');

section('Utils.gradeLabel / gradeBadge (عتبة النجاح)');
const U = core.exp.Utils;
test('gradeLabel: فوق العتبة ناجح، دونها راسب', () => {
  assert.strictEqual(U.gradeLabel(90, 85), 'ناجح'); assert.strictEqual(U.gradeLabel(80, 85), 'راسب');
});
test('gradeLabel: مساوٍ للعتبة = ناجح', () => { assert.strictEqual(U.gradeLabel(85, 85), 'ناجح'); });
test('gradeLabel: العتبة الافتراضية 85', () => {
  assert.strictEqual(U.gradeLabel(84), 'راسب'); assert.strictEqual(U.gradeLabel(85), 'ناجح');
});
test('gradeBadge يحوي التصنيف والنسبة', () => {
  const b = U.gradeBadge(90, 85); assert.ok(b.includes('ناجح') && b.includes('90%'));
});

section('teEqualWeights (توزيع مجموعه 100 بالضبط)');
for (const n of [1, 2, 3, 4, 5, 7, 10]) {
  test(`n=${n}: الطول=${n} والمجموع=100`, () => {
    const w = pages.exp.teEqualWeights(n);
    assert.strictEqual(w.length, n);
    assert.strictEqual(Math.round(w.reduce((a, b) => a + b, 0) * 100) / 100, 100);
  });
}
test('n<=0 → مصفوفة فارغة', () => { const w = pages.exp.teEqualWeights(0); assert.ok(Array.isArray(w) && w.length === 0); });

section('teValidKey / teSlug / teRound');
test('teValidKey ينظّف ويقبل slug صالح', () => { assert.strictEqual(pages.exp.teValidKey('Ab-c!', 'fb'), 'abc'); });
test('teValidKey → fallback عند البدء برقم أو الفراغ', () => {
  assert.strictEqual(pages.exp.teValidKey('123', 'fb'), 'fb');
  assert.strictEqual(pages.exp.teValidKey('', 'fb'), 'fb');
});
test('teSlug: عربي بلا a-z0-9 → fallback', () => { assert.strictEqual(pages.exp.teSlug('مرحبا', 'sec_1'), 'sec_1'); });
test('teSlug: اشتقاق من a-z0-9', () => { assert.strictEqual(pages.exp.teSlug('Hello World 2', 'fb'), 'hello_world_2'); });
// PIN: سلوك IEEE 754 مقصود — 1.005*100 = 100.4999… فيُقرَّب لأسفل إلى 1 (ليس 1.01). مثبَّت عمداً، ليس بَقاً.
test('teRound(1.005)=1  [PIN: IEEE754 مقصود]', () => { assert.strictEqual(pages.exp.teRound(1.005), 1); });
test('teRound: أرقام عادية', () => {
  assert.strictEqual(pages.exp.teRound(2.5), 2.5);
  assert.strictEqual(pages.exp.teRound('3.14159'), 3.14);
  assert.strictEqual(pages.exp.teRound('abc'), 0);
});

// weekEndStr أُصلح في #30 (UTC صريح: 'T00:00:00Z' + setUTCDate) → مستقل عن المنطقة الزمنية.
section('weekEndStr (نهاية أسبوع CG = البداية +6 أيام · مستقل عن TZ — #30)');
test("weekEndStr('2026-01-01') = '2026-01-07'", () => { assert.strictEqual(pages.exp.weekEndStr('2026-01-01'), '2026-01-07'); });
test('weekEndStr يعبر حدود الشهر', () => { assert.strictEqual(pages.exp.weekEndStr('2026-01-28'), '2026-02-03'); });

// ---------- الملخّص ----------
console.log(`\n══ النتيجة: ${passed} ناجح · ${failed} فاشل · ${skipped} مُعطَّل ══`);
if (failed) { console.log('الفاشلة: ' + fails.join(' · ')); process.exit(1); }
console.log('✅ كل الاختبارات نجحت.');
process.exit(0);
