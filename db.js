/**
 * Database Layer - Supabase CRUD Operations
 * طبقة البيانات - عمليات Supabase
 *
 * يدعم: قراءة، إضافة، تعديل، حذف
 * كل العمليات async/await
 *
 * بُنية الاستخدام:
 *   await DB.users.list()
 *   await DB.users.getById(id)
 *   await DB.users.create({...})
 *   await DB.users.update(id, {...})
 *   await DB.users.delete(id)
 */

(function() {
  const sb = () => window.supabaseClient;

  // =============================================
  // Users CRUD
  // =============================================
  const users = {
    async list(filter = {}) {
      let q = sb().from('users').select('*').order('id', { ascending: true });
      if (filter.role) q = q.eq('role', filter.role);
      if (filter.active !== undefined) q = q.eq('is_active', filter.active);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },

    async getById(id) {
      const { data, error } = await sb().from('users').select('*').eq('id', id).single();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },

    async getByEmail(email) {
      if (!email) return null;
      const { data, error } = await sb()
        .from('users')
        .select('*')
        .eq('email', email.trim().toLowerCase())
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async getByUsername(username) {
      const { data, error } = await sb()
        .from('users')
        .select('*')
        .eq('username', username)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async getSupervisors() {
      const { data, error } = await sb()
        .from('users')
        .select('*')
        .eq('role', 'supervisor')
        .eq('is_active', true)
        .order('full_name', { ascending: true });
      if (error) throw error;
      return data || [];
    },

    async create(user) {
      const existing = await this.getByUsername(user.username);
      if (existing) throw new Error('اسم المستخدم موجود مسبقاً');
      const emailExists = await this.getByEmail(user.email);
      if (emailExists) throw new Error('البريد الإلكتروني مستخدم مسبقاً');
      const payload = {
        ...user,
        is_active: user.is_active !== false,
        must_change_password: !!user.must_change_password
      };
      const { data, error } = await sb().from('users').insert(payload).select().single();
      if (error) throw error;
      await DB.audit.add({
        action: 'create_user',
        entity_type: 'user',
        entity_id: data.id,
        details: `إنشاء مستخدم: ${data.full_name} (${Utils.roleLabel(data.role)})`
      });
      return data;
    },

    async update(id, updates) {
      const { data, error } = await sb().from('users').update(updates).eq('id', id).select().single();
      if (error) throw error;
      await DB.audit.add({
        action: 'update_user',
        entity_type: 'user',
        entity_id: id,
        details: `تعديل بيانات المستخدم: ${data.full_name}`
      });
      return data;
    },

    async deactivate(id) {
      await this.update(id, { is_active: false });
    },

    async delete(id) {
      const { error } = await sb().from('users').delete().eq('id', id);
      if (error) throw error;
    },

    async resetPassword(id) {
      const tempPw = Utils.generateTempPassword();
      await this.update(id, {
        password: tempPw,
        must_change_password: true,
        password_reset_at: new Date().toISOString()
      });
      const u = await this.getById(id);
      await DB.audit.add({
        action: 'reset_password',
        entity_type: 'user',
        entity_id: id,
        details: `إعادة تعيين كلمة مرور المستخدم: ${u ? u.full_name : '#'+id}`
      });
      return tempPw;
    },

    async changePassword(id, newPw) {
      const { error } = await sb().from('users').update({
        password: newPw,
        must_change_password: false,
        password_changed_at: new Date().toISOString()
      }).eq('id', id);
      if (error) throw error;
      const u = await this.getById(id);
      await DB.audit.add({
        action: 'change_password',
        entity_type: 'user',
        entity_id: id,
        details: `تغيير كلمة مرور: ${u ? u.full_name : '#'+id}`
      });
    }
  };

  // =============================================
  // Evaluations CRUD
  // =============================================
  const evaluations = {
    async list(filter = {}) {
      let q = sb().from('evaluations').select('*').order('created_at', { ascending: false });
      if (filter.employee_id) q = q.eq('employee_id', filter.employee_id);
      if (filter.evaluator_id) q = q.eq('evaluator_id', filter.evaluator_id);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },

    async getById(id) {
      const { data, error } = await sb().from('evaluations').select('*').eq('id', id).single();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },

    async getAvgScore(employeeId) {
      const evals = await this.list({ employee_id: employeeId });
      if (!evals.length) return 0;
      return Math.round(evals.reduce((s,e) => s + Number(e.percentage), 0) / evals.length * 10) / 10;
    },

    async create(payload) {
      const { data, error } = await sb().from('evaluations').insert(payload).select().single();
      if (error) throw error;

      // إشعار للموظف
      const emp = await users.getById(data.employee_id);
      await DB.notifications.add({
        user_id: data.employee_id,
        title: 'تم استلام تقييم جديد',
        message: `تم تقييمك بنسبة ${data.percentage}% - ${data.grade}`,
        type: data.status === 'ناجح' ? 'success' : 'warning'
      });

      await DB.audit.add({
        action: 'create_evaluation',
        entity_type: 'evaluation',
        entity_id: data.id,
        details: `إنشاء تقييم #${data.id} للموظف ${emp ? emp.full_name : ''} - ${data.percentage}%`
      });
      return data;
    },

    async update(id, updates) {
      const { data, error } = await sb().from('evaluations').update(updates).eq('id', id).select().single();
      if (error) throw error;
      const emp = await users.getById(data.employee_id);
      await DB.audit.add({
        action: 'update_evaluation',
        entity_type: 'evaluation',
        entity_id: id,
        details: `تعديل تقييم #${id} للموظف ${emp ? emp.full_name : ''}`
      });
      return data;
    },

    async approve(id) {
      const ev = await this.getById(id);
      if (!ev) return null;
      if (!ev.action_taken) throw new Error('لا يمكن اعتماد التقييم بدون تحديد "الإجراء المتخذ"');
      const { error } = await sb().from('evaluations').update({
        approved: true,
        approved_at: new Date().toISOString(),
        approved_by: window.currentUser ? window.currentUser.id : null
      }).eq('id', id);
      if (error) throw error;
      await DB.audit.add({
        action: 'approve_evaluation',
        entity_type: 'evaluation',
        entity_id: id,
        details: `اعتماد تقييم #${id}`
      });
    },

    async recordSupervisorAction(id, payload) {
      const updates = {
        supervisor_action: payload.action || '',
        supervisor_action_other: payload.action_other || '',
        supervisor_notes: payload.notes || '',
        supervisor_action_by: window.currentUser ? window.currentUser.id : null,
        supervisor_action_by_name: window.currentUser ? window.currentUser.full_name : '',
        supervisor_action_at: new Date().toISOString()
      };
      const { data, error } = await sb().from('evaluations').update(updates).eq('id', id).select().single();
      if (error) throw error;
      const emp = await users.getById(data.employee_id);
      await DB.audit.add({
        action: 'supervisor_action',
        entity_type: 'evaluation',
        entity_id: id,
        details: `تسجيل إجراء المشرف على تقييم #${id} (${emp ? emp.full_name : ''}): ${payload.action || ''}`
      });
      await DB.notifications.add({
        user_id: data.employee_id,
        title: 'تم تسجيل إجراء على تقييمك',
        message: `قام المشرف باتخاذ إجراء: ${payload.action || ''}`
      });
      return data;
    },

    async delete(id) {
      const { error } = await sb().from('evaluations').delete().eq('id', id);
      if (error) throw error;
      await DB.audit.add({
        action: 'delete_evaluation',
        entity_type: 'evaluation',
        entity_id: id,
        details: `حذف تقييم #${id}`
      });
    }
  };

  // =============================================
  // Notifications CRUD
  // =============================================
  const notifications = {
    async list(userId) {
      const { data, error } = await sb()
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },

    async add(payload) {
      const { data, error } = await sb().from('notifications').insert(payload).select().single();
      if (error) throw error;
      return data;
    },

    async markAllRead(userId) {
      const { error } = await sb().from('notifications')
        .update({ is_read: true })
        .eq('user_id', userId)
        .eq('is_read', false);
      if (error) throw error;
    },

    async unreadCount(userId) {
      const { count, error } = await sb()
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false);
      if (error) return 0;
      return count || 0;
    }
  };

  // =============================================
  // Objections CRUD
  // =============================================
  const objections = {
    async list(filter = {}) {
      let q = sb().from('objections').select('*').order('created_at', { ascending: false });
      if (filter.employee_id) q = q.eq('employee_id', filter.employee_id);
      if (filter.evaluation_id) q = q.eq('evaluation_id', filter.evaluation_id);
      if (filter.status) q = q.eq('status', filter.status);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },

    async getById(id) {
      const { data, error } = await sb().from('objections').select('*').eq('id', id).single();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },

    async create(payload) {
      // توليد رقم مرجعي
      const year = new Date().getFullYear();
      const { count } = await sb().from('objections').select('id', { count: 'exact', head: true });
      const seq = String((count || 0) + 1).padStart(4, '0');
      const refNumber = `OBJ-${year}-${seq}`;

      const insertData = {
        ref_number: refNumber,
        evaluation_id: payload.evaluation_id,
        employee_id: payload.employee_id,
        reason: payload.reason,
        attachments: payload.attachments || [],
        status: 'pending',
        comments: []
      };

      const { data, error } = await sb().from('objections').insert(insertData).select().single();
      if (error) throw error;

      await DB.audit.add({
        action: 'submit_objection',
        entity_type: 'objection',
        entity_id: data.id,
        details: `تم تقديم اعتراض ${data.ref_number}`
      });
      return data;
    },

    async update(id, updates) {
      const { data, error } = await sb().from('objections').update(updates).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },

    async addComment(id, text) {
      const o = await this.getById(id);
      if (!o) return null;
      const comments = Array.isArray(o.comments) ? o.comments : [];
      comments.push({
        user_id: window.currentUser ? window.currentUser.id : null,
        user_name: window.currentUser ? window.currentUser.full_name : '-',
        role: window.currentUser ? window.currentUser.role : '',
        text,
        created_at: new Date().toISOString()
      });
      return this.update(id, { comments });
    },

    async resolve(id, decision, response) {
      const o = await this.getById(id);
      if (!o) return null;
      const comments = Array.isArray(o.comments) ? o.comments : [];
      if (response) {
        comments.push({
          user_id: window.currentUser ? window.currentUser.id : null,
          user_name: window.currentUser ? window.currentUser.full_name : '-',
          role: window.currentUser ? window.currentUser.role : '',
          text: response,
          created_at: new Date().toISOString(),
          is_resolution: true
        });
      }
      const updates = {
        status: decision,
        decision,
        resolved_at: new Date().toISOString(),
        resolved_by: window.currentUser ? window.currentUser.id : null,
        comments
      };
      await this.update(id, updates);

      await DB.audit.add({
        action: 'resolve_objection',
        entity_type: 'objection',
        entity_id: id,
        details: `تم البت في الاعتراض ${o.ref_number} - ${decision === 'accepted' ? 'مقبول' : 'مرفوض'}`
      });

      await DB.notifications.add({
        user_id: o.employee_id,
        title: 'تم الرد على اعتراضك',
        message: `الاعتراض ${o.ref_number}: ${decision === 'accepted' ? 'تم قبوله' : 'تم رفضه'}`
      });
    },

    async delete(id) {
      const { error } = await sb().from('objections').delete().eq('id', id);
      if (error) throw error;
    }
  };

  // =============================================
  // Audit Log
  // =============================================
  const audit = {
    async list(filter = {}) {
      let q = sb().from('audit_logs').select('*').order('timestamp', { ascending: false });
      if (filter.user_id) q = q.eq('user_id', filter.user_id);
      if (filter.action) q = q.eq('action', filter.action);
      if (filter.entity_type) q = q.eq('entity_type', filter.entity_type);
      if (filter.limit) q = q.limit(filter.limit);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },

    async add(payload) {
      const u = window.currentUser;
      const log = {
        user_id: u ? u.id : null,
        user_name: u ? u.full_name : 'النظام',
        role: u ? u.role : '-',
        action: payload.action,
        entity_type: payload.entity_type || '-',
        entity_id: payload.entity_id || null,
        details: payload.details || '',
        timestamp: new Date().toISOString()
      };
      const { error } = await sb().from('audit_logs').insert(log);
      if (error) console.warn('Failed to log audit:', error.message);
    }
  };

  // =============================================
  // Criteria (evaluation form structure)
  // =============================================
  const criteria = {
    async get() {
      const { data, error } = await sb()
        .from('criteria_config')
        .select('*')
        .eq('config_key', 'criteria')
        .maybeSingle();
      if (error) throw error;
      return data ? data.config_value : null;
    },

    async save(newCriteria) {
      const updateBy = window.currentUser ? window.currentUser.id : null;
      const { error } = await sb()
        .from('criteria_config')
        .upsert({
          config_key: 'criteria',
          config_value: newCriteria,
          updated_at: new Date().toISOString(),
          updated_by: updateBy
        }, { onConflict: 'config_key' });
      if (error) throw error;
    }
  };

  // =============================================
  // Dashboard Stats
  // =============================================
  const stats = {
    async dashboard(userId = null) {
      const allEvals = await evaluations.list(userId ? { employee_id: userId } : {});
      const totalEvals = allEvals.length;
      const avgPct = totalEvals
        ? Math.round(allEvals.reduce((s,e) => s + Number(e.percentage), 0) / totalEvals * 10) / 10
        : 0;
      const passed = allEvals.filter(e => e.status === 'ناجح').length;
      const failed = totalEvals - passed;

      const todayStr = new Date().toISOString().slice(0, 10);
      const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const today = allEvals.filter(e => e.evaluation_date === todayStr).length;
      const monthCount = allEvals.filter(e => new Date(e.created_at) >= monthAgo).length;

      let top = [], low = [];
      if (!userId) {
        const employees = (await users.list({ role: 'employee', active: true })) || [];
        const performers = await Promise.all(employees.map(async u => {
          const ue = allEvals.filter(e => e.employee_id === u.id);
          const sorted = ue.slice().sort((a,b) => new Date(b.evaluation_date) - new Date(a.evaluation_date));
          const lastApproved = sorted.find(e => e.approved) || sorted[0];
          return {
            id: u.id,
            name: u.full_name,
            count: ue.length,
            avg: ue.length ? Math.round(ue.reduce((s,e) => s + Number(e.percentage), 0) / ue.length * 10) / 10 : 0,
            lastEvalPct: lastApproved ? Number(lastApproved.percentage) : null,
            lastEvalDate: lastApproved ? lastApproved.evaluation_date : null,
            lastEvalApproved: !!(lastApproved && lastApproved.approved)
          };
        }));
        const filtered = performers.filter(p => p.count > 0);
        top = filtered.slice().sort((a,b) => b.avg - a.avg).slice(0, 5);
        low = filtered
          .filter(p => p.lastEvalPct !== null && p.lastEvalPct <= 75)
          .sort((a,b) => a.lastEvalPct - b.lastEvalPct)
          .slice(0, 10);
      }

      // Open / closed objections
      const allObjections = await objections.list();
      const objOpen = allObjections.filter(o => o.status === 'pending' || o.status === 'under_review').length;
      const objClosed = allObjections.filter(o => o.status === 'accepted' || o.status === 'rejected').length;

      const recent = allEvals.slice(0, 10);

      return {
        total: totalEvals,
        avg: avgPct,
        passed, failed,
        today, month: monthCount,
        top, low, recent,
        objOpen, objClosed
      };
    }
  };

  // =============================================
  // Public API
  // =============================================
  window.DB = {
    users,
    evaluations,
    notifications,
    objections,
    audit,
    criteria,
    stats
  };
})();
