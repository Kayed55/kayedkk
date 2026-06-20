/**
 * Modal Dialog
 * نافذة منبثقة قابلة لإعادة الاستخدام
 */

window.Modal = {
  _ensureOverlay() {
    let o = document.querySelector('.modal-overlay');
    if (!o) {
      o = document.createElement('div');
      o.className = 'modal-overlay';
      o.innerHTML = `
        <div class="modal">
          <div class="modal-header">
            <div class="modal-title"></div>
            <button class="modal-close" type="button">×</button>
          </div>
          <div class="modal-body"></div>
          <div class="modal-footer"></div>
        </div>`;
      document.body.appendChild(o);
      o.querySelector('.modal-close').addEventListener('click', () => this.close());
      o.addEventListener('click', e => { if (e.target === o) this.close(); });
    }
    return o;
  },

  show(title, bodyHTML, footerHTML = '') {
    const o = this._ensureOverlay();
    o.querySelector('.modal-title').textContent = title;
    o.querySelector('.modal-body').innerHTML = bodyHTML;
    o.querySelector('.modal-footer').innerHTML = footerHTML;
    o.classList.add('show');
  },

  close() {
    const o = document.querySelector('.modal-overlay');
    if (o) o.classList.remove('show');
  }
};
