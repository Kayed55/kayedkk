// يولّد 3 ملفات HTML خاصة بكل دور من manual.html (مصدر واحد) ثم تُبنى بـ build.js
const fs = require('fs'), path = require('path');
const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'manual.html'), 'utf8');

const head = (html.match(/<head>[\s\S]*?<\/head>/) || [''])[0];
const scripts = `<script>window.PagedConfig={auto:true,after:()=>{window.__PAGED_DONE__=true;}};</script>\n<script src="assets/paged.polyfill.min.js"></script>`;

// استخراج الأقسام (لا تداخل بينها)
const sections = html.match(/<section[\s\S]*?<\/section>/g) || [];
const map = {};
for (const s of sections) {
  if (/class="cover"/.test(s)) map.cover = s;
  else if (/class="toc"/.test(s)) map.toc = s;
  else { const m = s.match(/id="(intro|ch\d|quick)"/); if (m) map[m[1]] = s; }
}

function h1info(sec){ const m=(sec||'').match(/<h1 class="ch"[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/h1>/); return m?{id:m[1],title:m[2].replace(/<[^>]+>/g,'').trim()}:null; }

// اقتطاع بطاقة qcard لدور معيّن من قسمٍ (البطاقات إخوة)
function qcard(sectionKey, role){
  const sec = map[sectionKey] || '';
  const start = sec.indexOf('<div class="qcard '+role+'"');
  if (start < 0) return '';
  const after = sec.slice(start + 6);
  const cand = ['<div class="qcard ', '<hr', '</section>'].map(t=>after.indexOf(t)).filter(x=>x>=0);
  const cut = cand.length ? Math.min.apply(null, cand) : -1;
  return cut>=0 ? sec.slice(start, start+6+cut) : sec.slice(start);
}

function roleCover(sub){
  return map.cover.replace(/<div class="sub">[\s\S]*?<\/div>/, '<div class="sub">'+sub+'</div>');
}

function toc(chapterKeys, extra){
  const items = chapterKeys.map(k=>h1info(map[k])).filter(Boolean)
    .map(x=>`  <li class="sec"><a href="#${x.id}"><span class="t">${x.title}</span></a></li>`).join('\n');
  const ex = extra ? `\n  <li class="sec"><a href="#role-quick"><span class="t">الدليل السريع وأفضل الممارسات</span></a></li>` : '';
  return `<section class="toc">\n<h1 class="ch">الفهرس</h1>\n<p class="ch-tag">محتويات الدليل</p>\n<ul>\n${items}${ex}\n</ul>\n</section>`;
}

function trailing(role){
  const best = qcard('ch9', role), quick = qcard('quick', role);
  return `<section>\n<h1 class="ch" id="role-quick">الدليل السريع وأفضل الممارسات</h1>\n<p class="ch-tag">ملخّص مرجعي سريع</p>\n<h2>أفضل الممارسات</h2>\n${best}\n<h2>خطوات سريعة</h2>\n${quick}\n<hr class="soft">\n<p class="small" style="text-align:center">دليل استخدام نظام الجودة — شركة محزم · إصدار 1.0</p>\n</section>`;
}

const roles = {
  'دليل-الموظف':        { sub:'دليل الموظف',        role:'emp', chapters:['intro','ch1','ch2','ch7','ch8'] },
  'دليل-المشرف':        { sub:'دليل المشرف',        role:'sup', chapters:['intro','ch1','ch3','ch5','ch6','ch7','ch8'] },
  'دليل-موظف-الجودة':   { sub:'دليل موظف الجودة',   role:'qo',  chapters:['intro','ch1','ch4','ch5','ch6','ch7','ch8'] },
};

for (const [name, cfg] of Object.entries(roles)) {
  const body = [ roleCover(cfg.sub), toc(cfg.chapters, true),
                 ...cfg.chapters.map(k=>map[k]||''), trailing(cfg.role) ].join('\n\n');
  const doc = `<!DOCTYPE html>\n<html lang="ar" dir="rtl">\n${head}\n<body>\n${body}\n\n${scripts}\n</body>\n</html>`;
  const out = path.join(dir, name + '.html');
  fs.writeFileSync(out, doc, 'utf8');
  console.log('✅ ' + name + '.html  (' + cfg.chapters.length + ' فصول + دليل سريع)');
}
