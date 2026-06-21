/*!
 * نظام الجودة للتقييم والتدريب - شركة محزم
 *
 * Module: Database Layer (localStorage-based)
 * CRUD operations: users, evaluations, notifications, objections, audit, criteria, stats
 *
 * @module db
 * @copyright (c) 2026 Mahzam Co.
 */
'use strict';

// ============================================
// طبقة البيانات - localStorage
// ============================================
const DB = {
KEY: 'qe_system_v6',
data: null,

init() {
const saved = localStorage.getItem(this.KEY);
if (saved) {
try {
this.data = JSON.parse(saved);
if (!this.data.criteria) this.data.criteria = JSON.parse(JSON.stringify(DEFAULT_CRITERIA));
if (!this.data.objections) this.data.objections = [];
if (!this.data.audit_logs) this.data.audit_logs = [];
if (!this.data.nextObjectionId) this.data.nextObjectionId = 1;
if (!this.data.nextAuditId) this.data.nextAuditId = 1;
CRITERIA = this.data.criteria;
return;
} catch(e){}
}
this.data = {
users: [
{id:1, username:'admin', password:'Admin@123', full_name:'مدير النظام', email:'admin@example.com', phone:'', role:'admin', department:'الإدارة', position:'مدير النظام', employee_number:'ADM001', supervisor_name:'-', is_active:true, must_change_password:false, created_at:new Date().toISOString()},
{id:2, username:'qo1', password:'Quality@123', full_name:'خالد موظف الجودة', email:'quality@example.com', phone:'', role:'quality_officer', department:'قسم الجودة', position:'موظف جودة', employee_number:'QO001', supervisor_name:'مدير النظام', is_active:true, must_change_password:false, created_at:new Date().toISOString()},
{id:3, username:'supervisor', password:'Super@123', full_name:'محمد المشرف', email:'supervisor@example.com', phone:'', role:'supervisor', department:'قسم الجودة', position:'مشرف جودة', employee_number:'SUP001', supervisor_name:'-', is_active:true, must_change_password:false, created_at:new Date().toISOString()},
{id:4, username:'EMP001', password:'Emp@123A!', full_name:'أحمد علي', email:'emp001@example.com', phone:'', role:'employee', department:'قسم الجودة', position:'موظف خدمة', employee_number:'EMP001', supervisor_name:'محمد المشرف', supervisor_id:3, is_active:true, must_change_password:false, created_at:new Date().toISOString()},
{id:5, username:'EMP002', password:'Emp@123A!', full_name:'سارة محمد', email:'emp002@example.com', phone:'', role:'employee', department:'قسم الجودة', position:'موظف خدمة', employee_number:'EMP002', supervisor_name:'محمد المشرف', supervisor_id:3, is_active:true, must_change_password:false, created_at:new Date().toISOString()},
{id:6, username:'EMP003', password:'Emp@123A!', full_name:'فهد سعد', email:'emp003@example.com', phone:'', role:'employee', department:'قسم الجودة', position:'موظف خدمة', employee_number:'EMP003', supervisor_name:'محمد المشرف', supervisor_id:3, is_active:true, must_change_password:false, created_at:new Date().toISOString()},
{id:7, username:'EMP004', password:'Emp@123A!', full_name:'نورة خالد', email:'emp004@example.com', phone:'', role:'employee', department:'قسم الجودة', position:'موظف خدمة', employee_number:'EMP004', supervisor_name:'محمد المشرف', supervisor_id:3, is_active:true, must_change_password:false, created_at:new Date().toISOString()},
{id:8, username:'EMP005', password:'Emp@123A!', full_name:'عبدالله أحمد', email:'emp005@example.com', phone:'', role:'employee', department:'قسم الجودة', position:'موظف خدمة', employee_number:'EMP005', supervisor_name:'محمد المشرف', supervisor_id:3, is_active:true, must_change_password:false, created_at:new Date().toISOString()}
],
evaluations: [],
notifications: [],
objections: [],
audit_logs: [],
criteria: JSON.parse(JSON.stringify(DEFAULT_CRITERIA)),
nextUserId: 9,
nextEvalId: 1,
nextNotifId: 1,
nextObjectionId: 1,
nextAuditId: 1
};
CRITERIA = this.data.criteria;
this.save();
},

save() { localStorage.setItem(this.KEY, JSON.stringify(this.data)); },

// تحديث المعايير
saveCriteria(newCriteria) {
this.data.criteria = newCriteria;
CRITERIA = this.data.criteria;
this.save();
},

resetCriteria() {
this.data.criteria = JSON.parse(JSON.stringify(DEFAULT_CRITERIA));
CRITERIA = this.data.criteria;
this.save();
},

// Users
getUsers(filter={}) {
return this.data.users.filter(u => {
if (filter.role && u.role !== filter.role) return false;
if (filter.active && !u.is_active) return false;
return true;
});
},
getUser(id) { return this.data.users.find(u => u.id === id); },
getUserByUsername(u) { return this.data.users.find(x => x.username === u); },
getUserByEmail(em) { if (!em) return null; const e = em.trim().toLowerCase(); return this.data.users.find(x => (x.email||'').toLowerCase() === e); },
getSupervisors() { return this.data.users.filter(u => u.role === 'supervisor' && u.is_active !== false).sort((a,b) => (a.full_name||'').localeCompare(b.full_name||'','ar')); },
resetUserPassword(userId) {
const u = this.getUser(userId);
if (!u) return null;
const tempPw = Utils.generateTempPassword();
u.password = tempPw;
u.must_change_password = true;
u.password_reset_at = new Date().toISOString();
this.save();
this.addAudit({ action:'reset_password', entity_type:'user', entity_id:userId, details:`إعادة تعيين كلمة مرور المستخدم: ${u.full_name}` });
return tempPw;
},
changePassword(userId, newPw) {
const u = this.getUser(userId);
if (!u) return null;
u.password = newPw;
u.must_change_password = false;
u.password_changed_at = new Date().toISOString();
this.save();
this.addAudit({ action:'change_password', entity_type:'user', entity_id:userId, details:`تغيير كلمة مرور: ${u.full_name}` });
return u;
},
createUser(user) {
if (this.getUserByUsername(user.username)) throw new Error('اسم المستخدم موجود مسبقاً');
const id = this.data.nextUserId++;
const newUser = { id, ...user, is_active:true, created_at:new Date().toISOString() };
this.data.users.push(newUser);
this.save();
this.addAudit({ action:'create_user', entity_type:'user', entity_id:id, details:`إنشاء مستخدم: ${newUser.full_name} (${Utils.roleLabel(newUser.role)})` });
// 📧 Email notification (fire-and-forget, لا يعطل الحفظ)
try { if (window.EmailService) window.EmailService.sendNewUserEmail(newUser, user.password || null).catch(function(e){ console.warn('Email (newUser) failed:', e && e.message); }); } catch(_){}
return newUser;
},
updateUser(id, updates) {
const u = this.getUser(id);
if (!u) return null;
Object.assign(u, updates, { updated_at:new Date().toISOString() });
this.save();
this.addAudit({ action:'update_user', entity_type:'user', entity_id:id, details:`تعديل بيانات المستخدم: ${u.full_name}` });
return u;
},
deactivateUser(id) {
const u = this.getUser(id);
if (u) { u.is_active = false; this.save(); this.addAudit({ action:'deactivate_user', entity_type:'user', entity_id:id, details:`تعطيل المستخدم: ${u.full_name}` }); }
},

// Evaluations
getEvaluations(filter={}) {
let evals = this.data.evaluations.slice();
if (filter.employee_id) evals = evals.filter(e => e.employee_id === filter.employee_id);
if (filter.evaluator_id) evals = evals.filter(e => e.evaluator_id === filter.evaluator_id);
return evals.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
},
getEvaluation(id) { return this.data.evaluations.find(e => e.id === id); },

createEvaluation(data) {
// Duplicate-check: same employee+evaluator+date+items hash within 5 seconds
const itemsKey = JSON.stringify(data.items || {});
const now = Date.now();
const dup = this.data.evaluations.find(e =>
e.employee_id === data.employee_id &&
e.evaluator_id === data.evaluator_id &&
e.evaluation_date === data.evaluation_date &&
JSON.stringify(e.items || {}) === itemsKey &&
(now - new Date(e.created_at).getTime()) < 5000
);
if (dup) {
console.warn('⚠️ Duplicate evaluation prevented (id=' + dup.id + ')');
return Object.assign({}, dup, { _duplicate: true });
}
const id = this.data.nextEvalId++;
const newEval = {
id,
employee_id: data.employee_id,
evaluator_id: data.evaluator_id,
evaluation_date: data.evaluation_date,
call_type: data.call_type || '',
observed_issue: data.observed_issue || '',
observed_issue_other: data.observed_issue_other || '',
action_taken: data.action_taken || '',
action_taken_other: data.action_taken_other || '',
// إجراء المشرف - يُسجل لاحقاً
supervisor_action: '',
supervisor_action_other: '',
supervisor_notes: '',
supervisor_action_by: null,
supervisor_action_by_name: '',
supervisor_action_at: null,
notes: data.notes || '',
items: data.items,
section_scores: data.section_scores,
total_score: data.total_score,
percentage: data.percentage,
grade: data.grade,
status: data.status,
created_at: new Date().toISOString(),
updated_at: new Date().toISOString()
};
this.data.evaluations.push(newEval);

// إشعار للموظف
this.createNotification({
user_id: data.employee_id,
title: 'تم استلام تقييم جديد',
message: `تم تقييمك بنسبة ${data.percentage}% - ${data.grade}`,
type: data.status === 'ناجح' ? 'success' : 'warning'
});

this.save();
const emp = this.getUser(data.employee_id);
this.addAudit({ action:'create_evaluation', entity_type:'evaluation', entity_id:id, details:`إنشاء تقييم #${id} للموظف ${emp?emp.full_name:''} - ${data.percentage}%` });
// 📧 Email notification (fire-and-forget، يحدث بعد الحفظ ولا يعطّله)
try { if (window.EmailService) window.EmailService.sendEvaluationEmail(newEval).catch(function(e){ console.warn('Email (evaluation) failed:', e && e.message); }); } catch(_){}
return newEval;
},

updateEvaluation(id, updates) {
const ev = this.getEvaluation(id);
if (!ev) return null;
Object.assign(ev, updates, { updated_at:new Date().toISOString() });
this.save();
const emp = this.getUser(ev.employee_id);
this.addAudit({ action:'update_evaluation', entity_type:'evaluation', entity_id:id, details:`تعديل تقييم #${id} للموظف ${emp?emp.full_name:''}` });
return ev;
},

// تسجيل إجراء المشرف على التقييم
recordSupervisorAction(id, data) {
const ev = this.getEvaluation(id);
if (!ev) return null;
ev.supervisor_action = data.action || '';
ev.supervisor_action_other = data.action_other || '';
ev.supervisor_notes = data.notes || '';
ev.supervisor_action_by = currentUser ? currentUser.id : null;
ev.supervisor_action_by_name = currentUser ? currentUser.full_name : '';
ev.supervisor_action_at = new Date().toISOString();
ev.updated_at = new Date().toISOString();
this.save();
const emp = this.getUser(ev.employee_id);
this.addAudit({ action:'supervisor_action', entity_type:'evaluation', entity_id:id, details:`تسجيل إجراء المشرف على تقييم #${id} (${emp?emp.full_name:''}): ${data.action || ''}` });
// إشعار للموظف
this.createNotification({
user_id: ev.employee_id,
title: 'تم تسجيل إجراء على تقييمك',
message: `قام المشرف باتخاذ إجراء: ${data.action || ''}`
});
// 📧 Email notification (fire-and-forget)
try { if (window.EmailService) window.EmailService.sendActionEmail(ev, data).catch(function(e){ console.warn('Email (action) failed:', e && e.message); }); } catch(_){}
return ev;
},

approveEvaluation(id) {
const ev = this.getEvaluation(id);
if (!ev) return null;
if (!ev.action_taken) { throw new Error('لا يمكن اعتماد التقييم بدون تحديد "الإجراء المتخذ"'); }
ev.approved = true;
ev.approved_at = new Date().toISOString();
ev.approved_by = currentUser ? currentUser.id : null;
this.save();
this.addAudit({ action:'approve_evaluation', entity_type:'evaluation', entity_id:id, details:`اعتماد تقييم #${id}` });
// 📧 Email notification (fire-and-forget)
try { if (window.EmailService) window.EmailService.sendApprovalEmail(ev).catch(function(e){ console.warn('Email (approval) failed:', e && e.message); }); } catch(_){}
return ev;
},

deleteEvaluation(id) {
const ev = this.getEvaluation(id);
this.data.evaluations = this.data.evaluations.filter(e => e.id !== id);
this.save();
if (ev) this.addAudit({ action:'delete_evaluation', entity_type:'evaluation', entity_id:id, details:`حذف تقييم #${id}` });
},

getAvgScore(employeeId) {
const evals = this.data.evaluations.filter(e => e.employee_id === employeeId);
if (!evals.length) return 0;
return Math.round(evals.reduce((s,e) => s+e.percentage, 0) / evals.length * 10) / 10;
},

// Notifications
getNotifications(userId) {
return this.data.notifications.filter(n => n.user_id === userId)
.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
},
createNotification(n) {
// Duplicate-check: same user+title+message within 5 seconds
const now = Date.now();
const dup = this.data.notifications.find(x =>
x.user_id === n.user_id &&
x.title === n.title &&
x.message === n.message &&
(now - new Date(x.created_at).getTime()) < 5000
);
if (dup) {
console.warn('⚠️ Duplicate notification prevented');
return Object.assign({}, dup, { _duplicate: true });
}
const id = this.data.nextNotifId++;
const created = { id, ...n, is_read:false, created_at:new Date().toISOString() };
this.data.notifications.push(created);
this.save();
return created;
},
markAllRead(userId) {
this.data.notifications.filter(n => n.user_id === userId).forEach(n => n.is_read = true);
this.save();
},

// Dashboard
getDashboardStats(userId=null) {
const isEmp = userId !== null;
let evals = this.data.evaluations.slice();
if (isEmp) evals = evals.filter(e => e.employee_id === userId);

const total = evals.length;
const avg = total ? Math.round(evals.reduce((s,e)=>s+e.percentage,0)/total*10)/10 : 0;
const passed = evals.filter(e => e.status === 'ناجح').length;
const failed = total - passed;

const now = new Date();
const todayStr = now.toISOString().substring(0,10);
const weekAgo = new Date(now.getTime() - 7*24*60*60*1000);
const monthAgo = new Date(now.getTime() - 30*24*60*60*1000);
const today = evals.filter(e => e.evaluation_date === todayStr).length;
const week = evals.filter(e => new Date(e.created_at) >= weekAgo).length;
const month = evals.filter(e => new Date(e.created_at) >= monthAgo).length;

const employees = this.data.users.filter(u => u.role === 'employee' && u.is_active);
const performers = employees.map(u => {
const ue = this.data.evaluations.filter(e => e.employee_id === u.id);
// آخر تقييم معتمد (إن وُجد)، وإلا آخر تقييم بشكل عام
const sorted = ue.slice().sort((a,b) => new Date(b.evaluation_date) - new Date(a.evaluation_date));
const lastApproved = sorted.find(e => e.approved) || sorted[0];
return {
id:u.id, name:u.full_name,
count: ue.length,
avg: ue.length ? Math.round(ue.reduce((s,e)=>s+e.percentage,0)/ue.length*10)/10 : 0,
lastEvalPct: lastApproved ? lastApproved.percentage : null,
lastEvalDate: lastApproved ? lastApproved.evaluation_date : null,
lastEvalApproved: !!(lastApproved && lastApproved.approved)
};
}).filter(p => p.count > 0);

const top = isEmp ? [] : performers.slice().sort((a,b)=>b.avg-a.avg).slice(0,5);
// "يحتاجون متابعة" = الموظفون الراسبون فقط (آخر تقييم ≤ 84%) بناءً على آخر تقييم معتمد
// إذا لم يوجد تقييم معتمد، يُعتمد على آخر تقييم بشكل عام
const low = isEmp ? [] : performers
.filter(p => p.lastEvalPct !== null && p.lastEvalPct <= 84)
.sort((a,b) => a.lastEvalPct - b.lastEvalPct)
.slice(0,10);

// Monthly trend (6 months)
const trend = [];
for (let i = 5; i >= 0; i--) {
const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
const ds = d.toISOString().substring(0,7);
const me = evals.filter(e => (e.created_at||'').substring(0,7) === ds);
const labels = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
trend.push({
month: labels[d.getMonth()],
count: me.length,
avg: me.length ? Math.round(me.reduce((s,e)=>s+e.percentage,0)/me.length*10)/10 : 0
});
}

const grades = { 'ناجح':0, 'جيد جداً':0, 'راسب':0 };
evals.forEach(e => { if (grades[e.grade] !== undefined) grades[e.grade]++; });

const recent = evals.slice().sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0,10);

// Objections counts
const objs = this.data.objections || [];
const objOpen = objs.filter(o => o.status === 'pending' || o.status === 'under_review').length;
const objClosed = objs.filter(o => o.status === 'accepted' || o.status === 'rejected').length;

return {
total, avg, passed, failed,
today, week, month,
top, low, trend, grades, recent,
objOpen, objClosed
};
},

// ============================================
// Objections - الاعتراضات
// ============================================
getObjections(filter={}) {
let list = (this.data.objections || []).slice();
if (filter.employee_id) list = list.filter(o => o.employee_id === filter.employee_id);
if (filter.evaluation_id) list = list.filter(o => o.evaluation_id === filter.evaluation_id);
if (filter.status) list = list.filter(o => o.status === filter.status);
if (filter.supervisor_name) {
list = list.filter(o => {
const emp = this.getUser(o.employee_id);
return emp && emp.supervisor_name === filter.supervisor_name;
});
}
return list.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
},
getObjection(id) { return (this.data.objections || []).find(o => o.id === id); },
createObjection(data) {
// Duplicate-check: same employee+evaluation+reason within 30 seconds
if (!this.data.objections) this.data.objections = [];
const now = Date.now();
const dup = this.data.objections.find(o =>
o.employee_id === data.employee_id &&
o.evaluation_id === data.evaluation_id &&
(o.reason || '').trim() === (data.reason || '').trim() &&
(now - new Date(o.created_at).getTime()) < 30000
);
if (dup) {
console.warn('⚠️ Duplicate objection prevented (ref=' + dup.ref_number + ')');
return Object.assign({}, dup, { _duplicate: true });
}
const id = this.data.nextObjectionId++;
const year = new Date().getFullYear();
const seq = String(id).padStart(4,'0');
const ref = `OBJ-${year}-${seq}`;
// جلب اسم المشرف من التقييم المرتبط لكي يظهر الاعتراض في لوحة المشرف
const _ev = (this.data.evaluations || []).find(e => e.id === data.evaluation_id);
const obj = {
id,
ref_number: ref,
evaluation_id: data.evaluation_id,
employee_id: data.employee_id,
supervisor_name: _ev ? (_ev.supervisor_name || null) : null,
reason: data.reason,
attachments: data.attachments || [],
status: 'pending',
comments: [],
created_at: new Date().toISOString(),
updated_at: new Date().toISOString(),
resolved_at: null,
resolved_by: null,
decision: null
};
if (!this.data.objections) this.data.objections = [];
this.data.objections.push(obj);
this.save();
this.addAudit({ action:'submit_objection', entity_type:'objection', entity_id:id, details:`تم تقديم اعتراض ${ref}` });
// 📧 Email notification (fire-and-forget) — يُرسَل إلى مسؤول الجودة
try { if (window.EmailService) window.EmailService.sendObjectionEmail(obj).catch(function(e){ console.warn('Email (objection) failed:', e && e.message); }); } catch(_){}
return obj;
},
updateObjection(id, updates) {
const o = this.getObjection(id);
if (!o) return null;
Object.assign(o, updates, { updated_at: new Date().toISOString() });
this.save();
return o;
},
addObjectionComment(id, comment) {
const o = this.getObjection(id);
if (!o) return null;
if (!o.comments) o.comments = [];
o.comments.push({
user_id: currentUser ? currentUser.id : null,
user_name: currentUser ? currentUser.full_name : '-',
role: currentUser ? currentUser.role : '',
text: comment,
created_at: new Date().toISOString()
});
o.updated_at = new Date().toISOString();
this.save();
return o;
},
resolveObjection(id, decision, response) {
const o = this.getObjection(id);
if (!o) return null;
o.status = decision; // 'accepted' or 'rejected'
o.decision = decision;
o.resolved_at = new Date().toISOString();
o.resolved_by = currentUser ? currentUser.id : null;
if (response) {
if (!o.comments) o.comments = [];
o.comments.push({
user_id: currentUser ? currentUser.id : null,
user_name: currentUser ? currentUser.full_name : '-',
role: currentUser ? currentUser.role : '',
text: response,
created_at: new Date().toISOString(),
is_resolution: true
});
}
this.save();
this.addAudit({ action:'resolve_objection', entity_type:'objection', entity_id:id, details:`تم البت في الاعتراض ${o.ref_number} - ${decision==='accepted'?'مقبول':'مرفوض'}` });
// notify employee
this.createNotification({
user_id: o.employee_id,
title: 'تم الرد على اعتراضك',
message: `الاعتراض ${o.ref_number}: ${decision==='accepted'?'تم قبوله':'تم رفضه'}`
});
return o;
},

// ============================================
// Audit Log - سجل العمليات
// ============================================
addAudit(data) {
if (!this.data.audit_logs) this.data.audit_logs = [];
if (!this.data.nextAuditId) this.data.nextAuditId = 1;
const log = {
id: this.data.nextAuditId++,
user_id: currentUser ? currentUser.id : null,
user_name: currentUser ? currentUser.full_name : 'النظام',
role: currentUser ? currentUser.role : '-',
action: data.action,
entity_type: data.entity_type || '-',
entity_id: data.entity_id || null,
details: data.details || '',
timestamp: new Date().toISOString()
};
this.data.audit_logs.push(log);
// keep last 2000
if (this.data.audit_logs.length > 2000) this.data.audit_logs = this.data.audit_logs.slice(-2000);
this.save();
return log;
},
getAuditLogs(filter={}) {
let list = (this.data.audit_logs || []).slice();
if (filter.user_id) list = list.filter(l => l.user_id === filter.user_id);
if (filter.action) list = list.filter(l => l.action === filter.action);
if (filter.entity_type) list = list.filter(l => l.entity_type === filter.entity_type);
if (filter.from) { const f = new Date(filter.from); list = list.filter(l => new Date(l.timestamp) >= f); }
if (filter.to) { const t = new Date(filter.to); list = list.filter(l => new Date(l.timestamp) <= t); }
return list.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
}
};
