/**
 * Supabase Client Initialization
 * يبدأ اتصال Supabase ويوفر العميل عبر window.supabaseClient
 */

(function initSupabase() {
  if (!window.supabase) {
    console.error('Supabase SDK not loaded. Check the CDN script tag in index.html');
    return;
  }

  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.AppConfig;

  if (!SUPABASE_URL || SUPABASE_URL.includes('YOUR_PROJECT_ID')) {
    console.warn('⚠️ Supabase config not set. Update js/config.js with your project URL and anon key.');
  }

  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: {
      headers: {
        'X-Client-Info': 'mahzam-quality-system/1.0.0'
      }
    }
  });

  console.log('✓ Supabase client initialized');
})();
