#!/usr/bin/env node
'use strict';
/**
 * حارس وقائي (Node core فقط — لا حزم npm):
 *   1) node --check لكل ملفات public/js/**.js  (صحّة الصياغة)
 *   2) كل RPC يستدعيه العميل (sb.rpc / window.sb.rpc / supabase.rpc) يجب أن يكون له
 *      إمّا ملف مصدر (CREATE FUNCTION) في security-migration/*.sql، أو مدخل في
 *      scripts/rpc-source-baseline.json (دَين desync معروف — قائمة تتقلّص).
 *   أي RPC عميل جديد بلا مصدر ولا baseline ⇒ فشل (يمنع تكرار desync #21).
 *
 * الأسماء الديناميكية (متغيّر بدل نصّ) ⇒ تحذير "dynamic RPC skipped" (لا فشل).
 * overloads في المصدر تُطابَق بالاسم فقط.
 *
 * أكواد الخروج:  0 = نجاح  ·  1 = فشل صياغة (node --check)  ·  2 = فشل desync
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(ROOT, 'public', 'js');
const SQL_DIR = path.join(ROOT, 'security-migration');
const BASELINE_FILE = path.join(__dirname, 'rpc-source-baseline.json');

function walk(dir, ext, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}
const rel = (f) => path.relative(ROOT, f);

// ---------- 1) node --check ----------
const jsFiles = walk(JS_DIR, '.js');
const syntaxErrors = [];
for (const f of jsFiles) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { syntaxErrors.push(`${rel(f)} — ${String((e.stderr || e.message) || '').split('\n')[0]}`); }
}

// ---------- 2) استخراج RPCs من العميل ----------
const STATIC_RE = /\.rpc\(\s*(['"`])([a-zA-Z0-9_]+)\1/g;   // .rpc('name') بأي نوع اقتباس
const ANY_RE = /\.rpc\(/g;                                  // كل استدعاء .rpc( (لعدّ الديناميكي)
const clientRpcs = new Map();                               // name -> أول ملف يستدعيه
const dynamicWarnings = [];
for (const f of jsFiles) {
  const src = fs.readFileSync(f, 'utf8');
  let m, staticCount = 0;
  STATIC_RE.lastIndex = 0;
  while ((m = STATIC_RE.exec(src))) { staticCount++; if (!clientRpcs.has(m[2])) clientRpcs.set(m[2], rel(f)); }
  const total = (src.match(ANY_RE) || []).length;
  if (total - staticCount > 0) dynamicWarnings.push(`${rel(f)} — ${total - staticCount} استدعاء RPC ديناميكي (اسم متغيّر) تُخُطِّي`);
}

// ---------- 3) الدوال ذات المصدر ----------
const FN_RE = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-zA-Z0-9_]+)/gi;
const sourced = new Set();
for (const f of walk(SQL_DIR, '.sql')) {
  const src = fs.readFileSync(f, 'utf8');
  let m; FN_RE.lastIndex = 0;
  while ((m = FN_RE.exec(src))) sourced.add(m[1].toLowerCase());
}

// ---------- 4) الـ baseline ----------
let baseline = {};
try { baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')); }
catch (e) { console.error(`⚠️  تعذّر قراءة baseline (${rel(BASELINE_FILE)}): ${e.message}`); }
const baselineKeys = new Set(Object.keys(baseline).filter((k) => !k.startsWith('_')).map((k) => k.toLowerCase()));
const clientKeysLower = new Set([...clientRpcs.keys()].map((k) => k.toLowerCase()));

// ---------- الحساب ----------
const newUnsourced = [];
for (const [name, file] of clientRpcs) {
  const n = name.toLowerCase();
  if (!sourced.has(n) && !baselineKeys.has(n)) newUnsourced.push({ name, file });
}
const nowSourced = [...baselineKeys].filter((n) => sourced.has(n));
const stale = [...baselineKeys].filter((n) => !clientKeysLower.has(n));

// ---------- التقرير ----------
console.log('── حارس مصادر RPC ──');
console.log(`ملفات js: ${jsFiles.length} · RPCs عميل: ${clientRpcs.size} · دوال بمصدر: ${sourced.size} · baseline: ${baselineKeys.size}`);
if (dynamicWarnings.length) { console.log('\n⚠️  أسماء RPC ديناميكية (تُخُطِّي، لا فشل):'); dynamicWarnings.forEach((w) => console.log('   - ' + w)); }
if (nowSourced.length) { console.log('\n⚠️  مدخلات baseline صار لها مصدر (أزِلها من baseline):'); nowSourced.forEach((n) => console.log('   - ' + n)); }
if (stale.length) { console.log('\n⚠️  مدخلات baseline لم تعد تُستدعى من العميل (قديمة، أزِلها):'); stale.forEach((n) => console.log('   - ' + n)); }

if (syntaxErrors.length) {
  console.error('\n❌ فشل صياغة (node --check):');
  syntaxErrors.forEach((e) => console.error('   - ' + e));
  process.exit(1);
}
if (newUnsourced.length) {
  console.error('\n❌ desync: RPCs يستدعيها العميل بلا مصدر ولا baseline:');
  newUnsourced.forEach((u) => console.error(`   - ${u.name}  (في ${u.file})`));
  console.error('\n   الحل: أضِف ملف مصدر (CREATE FUNCTION) في security-migration/، أو — إن كان دَيناً قائماً —');
  console.error('        أضِف الاسم إلى scripts/rpc-source-baseline.json مع reason واضح.');
  process.exit(2);
}
console.log('\n✅ سليم: كل RPCs العميل لها مصدر أو baseline، ولا أخطاء صياغة.');
process.exit(0);
