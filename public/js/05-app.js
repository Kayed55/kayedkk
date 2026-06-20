/*!
 * نظام الجودة للتقييم والتدريب - شركة محزم
 *
 * Module: Application Bootstrap
 * Initializes the database and starts the router based on saved session.
 *
 * @module app
 * @copyright (c) 2026 Mahzam Co.
 */
'use strict';

// تشغيل التطبيق
DB.init();
const saved = localStorage.getItem('qe_current_user');
if (saved) {
try { currentUser = JSON.parse(saved); navigate('dashboard'); }
catch(e) { navigate('login'); }
} else {
navigate('login');
}
