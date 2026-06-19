/**
 * Utility Functions
 * نظام الجودة للتقييم والتدريب - شركة محزم
 */

window.Utils = {
  escape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
  },

  formatDate(d) {
    if (!d) return '-';
    const dt = new Date(d);
    return `${dt.getDate().toString().padStart(2,'0')}/${(dt.getMonth()+1).toString().padStart(2,'0')}/${dt.getFullYear()}`;
  },

  formatDateTime(d) {
    if (!d) return '-';
    const dt = new Date(d);
    return `${this.formatDate(d)} ${dt.getHours().toString().padStart(2,'0')}:${dt.getMinutes().toString().padStart(2,'0')}`;
  },

  getInitials(n) {
    return (n || '?').split(' ').map(w => w[0]).slice(0,2).join('');
  },

  roleLabel(r) {
    return ({
      admin: 'مدير النظام',
      quality_officer: 'موظف الجودة',
      supervisor: 'مشرف',
      employee: 'موظف'
    })[r] || r;
  },

  roleBadge(r) {
    const colors = {
      admin: '#1e40af',
      quality_officer: '#0891b2',
      supervisor: '#7c3aed',
      employee: '#64748b'
    };
    const c = colors[r] || '#64748b';
    return `<span class="badge" style="background:${c}33;color:${c}">${this.roleLabel(r)}</span>`;
  },

  // تصنيف جديد: ≤75 راسب | 76-80 جيد جداً | 81+ ناجح
  gradeBadge(p) {
    let cls = 'badge-danger', txt = 'راسب';
    if (p >= 81) { cls = 'badge-success'; txt = 'ناجح'; }
    else if (p >= 76) { cls = 'badge-info'; txt = 'جيد جداً'; }
    return `<span class="badge ${cls}">${txt} ${p}%</span>`;
  },

  gradeLabel(p) {
    if (p >= 81) return 'ناجح';
    if (p >= 76) return 'جيد جداً';
    return 'راسب';
  },

  timeAgo(d) {
    const diff = (Date.now() - new Date(d).getTime()) / 1000;
    if (diff < 60) return 'قبل لحظات';
    if (diff < 3600) return `قبل ${Math.floor(diff/60)} دقيقة`;
    if (diff < 86400) return `قبل ${Math.floor(diff/3600)} ساعة`;
    return `قبل ${Math.floor(diff/86400)} يوم`;
  },

  objectionStatus(s) {
    const map = {
      pending: { label: 'قيد الانتظار', cls: 'badge-warning' },
      under_review: { label: 'قيد المراجعة', cls: 'badge-info' },
      accepted: { label: 'مقبول', cls: 'badge-success' },
      rejected: { label: 'مرفوض', cls: 'badge-danger' }
    };
    const o = map[s] || { label: s, cls: 'badge-info' };
    return `<span class="badge ${o.cls}">${o.label}</span>`;
  },

  formatBytes(b) {
    if (!b) return '0 B';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
    return (b/1048576).toFixed(2) + ' MB';
  },

  // التحقق من سياسة كلمة المرور
  validatePassword(pw) {
    const errors = [];
    if (!pw || pw.length < 8) errors.push('يجب أن تكون كلمة المرور 8 أحرف على الأقل');
    if (!/[A-Za-z]/.test(pw)) errors.push('يجب أن تحتوي على حرف واحد على الأقل');
    if (!/[0-9]/.test(pw)) errors.push('يجب أن تحتوي على رقم واحد على الأقل');
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(pw)) errors.push('يجب أن تحتوي على رمز خاص (@!#$%^&*) واحد على الأقل');
    return { valid: errors.length === 0, errors };
  },

  validateEmail(em) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em || '');
  },

  generateTempPassword() {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
    const numbers = '23456789';
    const symbols = '!@#$%&*';
    let p = '';
    p += letters.charAt(Math.floor(Math.random() * letters.length));
    p += numbers.charAt(Math.floor(Math.random() * numbers.length));
    p += symbols.charAt(Math.floor(Math.random() * symbols.length));
    const all = letters + numbers + symbols;
    for (let i = 0; i < 7; i++) p += all.charAt(Math.floor(Math.random() * all.length));
    return p.split('').sort(() => Math.random() - 0.5).join('');
  },

  // حساب النتيجة بناءً على البنود
  calculateScores(items, criteria) {
    const A = criteria.answers;
    const sectionScores = {};
    const errors = [];

    criteria.sections.forEach(s => {
      if (s.type === 'critical') {
        // قسم حرج: أي خطأ = صفر للقسم بأكمله
        let hasError = false;
        s.subsections.forEach(sub => sub.items.forEach(it => {
          const ans = items[it.key] || A.OK;
          if (ans === A.ERR) { hasError = true; errors.push(it.label); }
        }));
        sectionScores[s.key] = hasError ? 0 : s.weight;
      } else {
        // قسم غير حرج: حساب نسبي
        let totalSubWeight = 0;
        let earnedSubScore = 0;
        s.subsections.forEach(sub => {
          const subWeight = sub.weight || (s.weight / s.subsections.length);
          totalSubWeight += subWeight;
          const items_count = sub.items.length;
          let counted = 0, ok = 0;
          sub.items.forEach(it => {
            const ans = items[it.key] || A.OK;
            if (ans !== A.NA) {
              counted++;
              if (ans === A.OK) ok++;
              else errors.push(it.label);
            }
          });
          const sectionPct = counted ? (ok / counted) : 1;
          earnedSubScore += subWeight * sectionPct;
        });
        sectionScores[s.key] = Math.round((earnedSubScore) * 10) / 10;
      }
    });

    const totalScore = Math.round(Object.values(sectionScores).reduce((a,b) => a+b, 0) * 10) / 10;
    const percentage = totalScore;

    let grade, status;
    if (percentage <= 75) { grade = 'راسب'; status = 'راسب'; }
    else if (percentage <= 80) { grade = 'جيد جداً'; status = 'ناجح'; }
    else { grade = 'ناجح'; status = 'ناجح'; }

    return { sectionScores, totalScore, percentage, grade, status, errors };
  }
};
