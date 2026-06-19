/**
 * Role-Based Permissions
 * نظام الصلاحيات حسب الدور
 */

window.Perms = {
  // الأدوار: admin (مدير) | quality_officer (موظف الجودة) | supervisor (مشرف) | employee (موظف)
  _map: {
    'manage_users':        ['admin'],
    'view_audit_log':      ['admin', 'quality_officer'],
    'manage_settings':     ['admin'],
    'create_evaluation':   ['admin', 'quality_officer'],
    'edit_evaluation':     ['admin', 'quality_officer'],
    'approve_evaluation':  ['admin', 'quality_officer'],
    'delete_evaluation':   ['admin', 'quality_officer'],
    'view_all_evaluations':['admin', 'quality_officer'],
    'view_all_reports':    ['admin', 'quality_officer'],
    'view_team_reports':   ['admin', 'quality_officer', 'supervisor'],
    'manage_objections':   ['admin', 'quality_officer'],
    'submit_objection':    ['employee'],
    'view_team_objections':['admin', 'quality_officer', 'supervisor'],
    'view_employees':      ['admin', 'quality_officer', 'supervisor']
  },

  can(action) {
    if (!window.currentUser) return false;
    return (this._map[action] || []).includes(window.currentUser.role);
  }
};
