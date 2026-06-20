/**
 * Authentication Module
 * تسجيل الدخول والخروج وإعادة تعيين كلمة المرور
 *
 * ملاحظة أمنية للإنتاج:
 * هذا التطبيق يستخدم custom auth في جدول users.
 * للأمان الأقصى في الإنتاج، انتقل إلى Supabase Auth وأضف bcrypt لكلمات المرور.
 */

window.Auth = {
  async login(email, password) {
    if (!Utils.validateEmail(email)) throw new Error('البريد الإلكتروني غير صالح');
    const user = await DB.users.getByEmail(email);
    if (!user || user.password !== password || !user.is_active) {
      // تسجيل المحاولة الفاشلة
      await DB.audit.add({
        action: 'failed_login',
        entity_type: 'login',
        details: `محاولة دخول فاشلة - ${email}`
      });
      throw new Error('البريد الإلكتروني أو كلمة المرور غير صحيحة');
    }

    // حفظ الجلسة
    const sessionUser = {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      email: user.email
    };
    window.currentUser = sessionUser;
    localStorage.setItem(window.AppConfig.AUTH_STORAGE_KEY, JSON.stringify(sessionUser));

    await DB.audit.add({
      action: 'login',
      entity_type: 'login',
      entity_id: user.id,
      details: `تسجيل دخول: ${user.full_name} (${user.email})`
    });

    return user;
  },

  logout() {
    if (window.currentUser) {
      // حفظ سجل خروج بدون انتظار (fire and forget)
      DB.audit.add({
        action: 'logout',
        entity_type: 'logout',
        details: `تسجيل خروج: ${window.currentUser.full_name}`
      }).catch(() => {});
    }
    window.currentUser = null;
    localStorage.removeItem(window.AppConfig.AUTH_STORAGE_KEY);
  },

  restore() {
    try {
      const raw = localStorage.getItem(window.AppConfig.AUTH_STORAGE_KEY);
      if (raw) {
        window.currentUser = JSON.parse(raw);
        return window.currentUser;
      }
    } catch(e) {}
    return null;
  },

  async forgotPassword(email) {
    if (!Utils.validateEmail(email)) throw new Error('بريد إلكتروني غير صالح');
    const u = await DB.users.getByEmail(email);
    if (!u) throw new Error('لا يوجد حساب بهذا البريد الإلكتروني');
    if (!u.is_active) throw new Error('الحساب معطّل، تواصل مع المدير');
    return await DB.users.resetPassword(u.id);
  }
};
