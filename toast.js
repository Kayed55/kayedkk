/**
 * Toast Notifications
 * إشعارات منبثقة
 */

window.Toast = {
  _ensureContainer() {
    let c = document.querySelector('.toast-container');
    if (!c) {
      c = document.createElement('div');
      c.className = 'toast-container';
      document.body.appendChild(c);
    }
    return c;
  },

  show(message, type = 'info', duration = 3500) {
    const c = this._ensureContainer();
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    const icons = { success: '✓', error: '✗', warning: '⚠', info: 'ℹ' };
    t.innerHTML = `<span style="font-size:18px">${icons[type] || icons.info}</span><div>${message}</div>`;
    c.appendChild(t);
    setTimeout(() => {
      t.style.transition = '0.3s';
      t.style.opacity = '0';
      t.style.transform = 'translateX(-100%)';
      setTimeout(() => t.remove(), 300);
    }, duration);
  },

  success(msg) { this.show(msg, 'success'); },
  error(msg)   { this.show(msg, 'error', 5000); },
  warning(msg) { this.show(msg, 'warning'); },
  info(msg)    { this.show(msg, 'info'); }
};
