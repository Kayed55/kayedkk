/*!
 * نظام الجودة للتقييم والتدريب - شركة محزم
 *
 * Module: Core Utilities
 * Contains: calculateScores, Utils (formatters, validators), Perms (RBAC), Toast, Modal
 *
 * @module core
 * @copyright (c) 2026 Mahzam Co.
 */
'use strict';

// ============================================
// حساب الدرجات
// ============================================
function calculateScores(items) {
const A = CRITERIA.answers;
const sectionScores = {};
const errors = [];

CRITERIA.sections.forEach(s => {
if (s.type === 'critical') {
// كل البنود في القسم: لو فيه أي خطأ → 0، وإلا → كامل الوزن
let hasError = false;
s.subsections.forEach(sub => {
sub.items.forEach(it => {
const a = items[it.key] || A.OK;
if (a === A.ERR) {
hasError = true;
errors.push({ section:s.title, subsection:sub.title, item:it.label });
}
});
});
sectionScores[s.key] = hasError ? 0 : s.weight;
} else {
// القسم الرابع: مرجح حسب الأقسام الفرعية
let total = 0;
s.subsections.forEach(sub => {
const items_ = sub.items;
const applicable = items_.filter(it => (items[it.key] || A.OK) !== A.NA);
const correct = applicable.filter(it => (items[it.key] || A.OK) === A.OK);
const subScore = applicable.length ? (correct.length / applicable.length) * sub.weight : sub.weight;
total += subScore;
items_.forEach(it => {
if ((items[it.key] || A.OK) === A.ERR) {
errors.push({ section:s.title, subsection:sub.title, item:it.label });
}
});
});
sectionScores[s.key] = Math.round(total * 10) / 10;
}
});

const totalScore = Math.round(Object.values(sectionScores).reduce((a,b)=>a+b, 0) * 10) / 10;
const percentage = totalScore;

// التصنيف الثنائي:
// 84% وأقل = راسب | 85-100% = ناجح
let grade, status;
if (percentage >= 85) { grade = 'ناجح'; status = 'ناجح'; }
else { grade = 'راسب'; status = 'راسب'; }

return { sectionScores, totalScore, percentage, grade, status, errors };
}

// ============================================
// أدوات
// ============================================
const Utils = {
escape(s) { return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
formatDate(d) { if (!d) return '-'; const dt = new Date(d); return `${dt.getDate().toString().padStart(2,'0')}/${(dt.getMonth()+1).toString().padStart(2,'0')}/${dt.getFullYear()}`; },
getInitials(n) { return (n||'?').split(' ').map(w=>w[0]).slice(0,2).join(''); },
roleLabel(r) { return {admin:'مدير النظام', quality_officer:'موظف الجودة', supervisor:'مشرف', employee:'موظف', manager:'مدير قسم'}[r] || r; },
roleBadge(r) { const colors = {admin:'#1e40af', quality_officer:'#0891b2', supervisor:'#7c3aed', employee:'#64748b'}; return `<span class="badge" style="background:${colors[r]||'#64748b'}33;color:${colors[r]||'#64748b'}">${this.roleLabel(r)}</span>`; },
// التصنيف الثنائي: 84 وأقل = راسب | 85+ = ناجح
gradeBadge(p) {
let cls = 'badge-danger', txt = 'راسب';
if (p >= 85) { cls = 'badge-success'; txt = 'ناجح'; }
return `<span class="badge ${cls}">${txt} ${p}%</span>`;
},
gradeLabel(p) {
return p >= 85 ? 'ناجح' : 'راسب';
},
timeAgo(d) {
const diff = (Date.now() - new Date(d).getTime()) / 1000;
if (diff < 60) return 'قبل لحظات';
if (diff < 3600) return `قبل ${Math.floor(diff/60)} دقيقة`;
if (diff < 86400) return `قبل ${Math.floor(diff/3600)} ساعة`;
return `قبل ${Math.floor(diff/86400)} يوم`;
},
formatDateTime(d) { if (!d) return '-'; const dt = new Date(d); return `${this.formatDate(d)} ${dt.getHours().toString().padStart(2,'0')}:${dt.getMinutes().toString().padStart(2,'0')}`; },
objectionStatus(s) {
const map = {
pending: { label:'قيد الانتظار', cls:'badge-warning' },
under_review: { label:'قيد المراجعة', cls:'badge-info' },
accepted: { label:'مقبول', cls:'badge-success' },
rejected: { label:'مرفوض', cls:'badge-danger' }
};
const o = map[s] || { label:s, cls:'badge-info' };
return `<span class="badge ${o.cls}">${o.label}</span>`;
},
formatBytes(b) { if (!b) return '0 B'; if (b < 1024) return b + ' B'; if (b < 1048576) return (b/1024).toFixed(1) + ' KB'; return (b/1048576).toFixed(2) + ' MB'; },

// Password policy validation
validatePassword(pw) {
const errors = [];
if (!pw || pw.length < 8) errors.push('يجب أن تكون كلمة المرور 8 أحرف على الأقل');
if (!/[A-Za-z]/.test(pw)) errors.push('يجب أن تحتوي على حرف واحد على الأقل');
if (!/[0-9]/.test(pw)) errors.push('يجب أن تحتوي على رقم واحد على الأقل');
if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(pw)) errors.push('يجب أن تحتوي على رمز خاص (@!#$%^&*) واحد على الأقل');
return { valid: errors.length === 0, errors };
},
// Email validation
validateEmail(em) {
return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em||'');
},
// Generate strong temp password
generateTempPassword() {
const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
const numbers = '23456789';
const symbols = '!@#$%&*';
let p = '';
p += letters.charAt(Math.floor(Math.random()*letters.length));
p += numbers.charAt(Math.floor(Math.random()*numbers.length));
p += symbols.charAt(Math.floor(Math.random()*symbols.length));
const all = letters + numbers + symbols;
for (let i=0; i<7; i++) p += all.charAt(Math.floor(Math.random()*all.length));
return p.split('').sort(()=>Math.random()-0.5).join('');
}
};

// ============================================
// Permissions - نظام الصلاحيات
// ============================================
const Perms = {
// roles: admin (full), quality_officer (eval+objection management), supervisor (view team), employee (view own)
can(action) {
if (!currentUser) return false;
const r = currentUser.role;
const map = {
'manage_users': ['admin'],
'view_audit_log': ['admin','quality_officer'],
'manage_settings': ['admin'],
'create_evaluation': ['admin','quality_officer'],
'edit_evaluation': ['admin','quality_officer'],
'approve_evaluation': ['admin','quality_officer'],
'delete_evaluation': ['admin'],
'manage_criteria': ['admin','quality_officer'],
'view_all_evaluations': ['admin','quality_officer'],
'view_all_reports': ['admin','quality_officer'],
'view_team_reports': ['admin','quality_officer','supervisor'],
'manage_objections': ['admin','quality_officer'],
'submit_objection': ['employee'],
'view_team_objections': ['admin','quality_officer','supervisor'],
'view_employees': ['admin','quality_officer','supervisor']
};
return (map[action] || []).includes(r);
}
};

// Ensure toast & modal containers exist (idempotent)
function ensureUIContainers() {
if (!document.getElementById('toast-container')) {
const c = document.createElement('div');
c.id = 'toast-container';
c.className = 'toast-container';
document.body.appendChild(c);
}
if (!document.getElementById('modal-container')) {
const m = document.createElement('div');
m.id = 'modal-container';
document.body.appendChild(m);
}
}

// Toast
const Toast = {
show(msg, type='info') {
ensureUIContainers();
const c = document.getElementById('toast-container');
const t = document.createElement('div');
t.className = 'toast ' + type;
t.textContent = msg;
c.appendChild(t);
setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
},
success(m){this.show(m,'success')},
error(m){this.show(m,'error')},
warning(m){this.show(m,'warning')},
info(m){this.show(m,'info')}
};

// Modal
const Modal = {
show(title, body, footer) {
ensureUIContainers();
document.getElementById('modal-container').innerHTML = `
<div class="modal-overlay show" onclick="if(event.target===this)Modal.close()">
<div class="modal" role="dialog" aria-modal="true" aria-label="${(title||'').replace(/<[^>]+>/g,'').replace(/"/g,'&quot;')}">
<div class="modal-header"><div class="modal-title">${title}</div><button class="modal-close" onclick="Modal.close()" aria-label="إغلاق">×</button></div>
<div class="modal-body">${body}</div>
${footer ? `<div class="modal-footer">${footer}</div>` : ''}
</div></div>`;
// منع تمرير الخلفية أثناء فتح المودال
document.body.style.overflow = 'hidden';
},
close() {
const m = document.getElementById('modal-container');
if (m) m.innerHTML = '';
document.body.style.overflow = '';
},
isOpen() {
const m = document.getElementById('modal-container');
return !!(m && m.querySelector('.modal-overlay.show'));
}
};

// إغلاق المودال بمفتاح ESC - يُربط مرة واحدة فقط
if (typeof document !== 'undefined' && !window.__modalEscBound) {
window.__modalEscBound = true;
document.addEventListener('keydown', (e) => {
if (e.key === 'Escape' && Modal.isOpen()) Modal.close();
});
}

// ============================================
// submitWithFeedback - الدالة المساعدة الموحّدة لجميع عمليات الحفظ
// ============================================
// - تُعطّل الزر وتُظهر "جاري الحفظ..."
// - تنتظر الدالة غير المتزامنة
// - عند النجاح: تعرض رسالة، تُغلق المودال، تُعيد رسم الصفحة الحالية
// - عند الخطأ: تعرض Toast.error برسالة واضحة
// - تمنع الضغطات المتكررة (re-entry guard)
// - استخدام: await submitWithFeedback(btn, 'جاري الحفظ...', 'تم الحفظ', async () => { ... });
// - إذا أرجعت الدالة المتداخلة `false` فلن تُغلَق المودال ولن تُعاد الصفحة (للتحقّق الفاشل)
async function submitWithFeedback(btn, savingText, successText, asyncFn) {
if (typeof asyncFn !== 'function') {
console.warn('submitWithFeedback: asyncFn must be a function');
return;
}
// منع الضغطات المتكررة
if (btn && btn.dataset && btn.dataset.busy === '1') return;
let originalText = '', originalDisabled = false, originalHTML = '';
if (btn) {
btn.dataset.busy = '1';
originalDisabled = !!btn.disabled;
originalText = btn.textContent;
originalHTML = btn.innerHTML;
btn.disabled = true;
btn.setAttribute('aria-busy', 'true');
btn.textContent = savingText || 'جاري الحفظ...';
}
let result;
try {
result = await asyncFn();
if (result === false) {
// إشارة من المتداخلة بأن التحقق فشل أو لا حاجة لإغلاق المودال
return result;
}
if (successText) {
try { Toast.success(successText); } catch(_) {}
}
// إغلاق المودال إن وُجد
try { if (typeof Modal !== 'undefined') Modal.close(); } catch(_) {}
// إعادة رسم الصفحة الحالية لتحديث الواجهة فوراً
try {
if (typeof navigate === 'function' && typeof currentPage !== 'undefined' && currentPage && currentPage !== 'login') {
const params = (typeof currentParams !== 'undefined') ? currentParams : {};
navigate(currentPage, params);
}
} catch(_) {}
return result;
} catch (e) {
console.error('submitWithFeedback error:', e);
const msg = (e && e.message) ? e.message : 'حدث خطأ أثناء الحفظ، حاول مرة أخرى';
try { Toast.error(msg); } catch(_) {}
return undefined;
} finally {
if (btn) {
btn.dataset.busy = '0';
btn.disabled = originalDisabled;
btn.removeAttribute('aria-busy');
// استعادة المحتوى الأصلي (HTML للاحتفاظ بالأيقونات)
if (originalHTML !== originalText) btn.innerHTML = originalHTML;
else btn.textContent = originalText;
}
}
}

// Expose globally for inline handlers
window.submitWithFeedback = submitWithFeedback;
window.ensureUIContainers = ensureUIContainers;
