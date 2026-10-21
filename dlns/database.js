(function () {
  'use strict';

  const URL = 'https://urwhknxbumwjcuplfwni.supabase.co';
  const KEY = 'sb_publishable_WnP1QNaJOLB5wtHQ2krzQw_NyoZVXLn';
  const CACHE = 'dlns.database.matches.v1';
  const AUTH_STORAGE = 'dlns.auth.v1';
  const RETURN_TAB = 'dlns.auth.returnTab';
  const auth = {user:null,admin:false,ready:true,error:''};
  const listeners = new Set();
  let clientPromise, client, matches = [], authVersion = 0;

  function notify() {
    listeners.forEach(listener => listener({...auth}));
  }

  function readCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE) || 'null');
      if (cached && Array.isArray(cached.matches)) {
        matches = cached.matches;
        return cached;
      }
    } catch (_) {}
    return null;
  }

  function remember(next) {
    matches = next.slice().sort((a,b) => DLNSModel.chronology(a.match_id)-DLNSModel.chronology(b.match_id));
    try { localStorage.setItem(CACHE,JSON.stringify({at:Date.now(),matches})); } catch (_) {}
    return matches;
  }

  async function loadMatches() {
    const all = [];
    for (let offset = 0;; offset += 500) {
      const query = new URLSearchParams({select:'*',order:'week.asc,region.asc,round.asc,game.asc',limit:'500',offset:String(offset)});
      const response = await fetch(`${URL}/rest/v1/dlns_matches?${query}`,{headers:{apikey:KEY},cache:'no-store'});
      if (!response.ok) throw new Error(`The match database could not be loaded (${response.status}).`);
      const page = await response.json();
      if (!Array.isArray(page)) throw new Error('The match database returned an invalid response.');
      all.push(...page);
      if (page.length < 500) break;
    }
    return remember(all);
  }

  async function refreshAuth(session) {
    const version = ++authVersion;
    auth.user = session?.user || null;
    auth.admin = false;
    auth.ready = !session;
    auth.error = '';
    notify();
    if (session) {
      const {data,error} = await client.rpc('dlns_is_admin');
      if (version !== authVersion) return;
      auth.admin = !error && data === true;
      auth.ready = true;
      if (error) auth.error = 'Your editing permissions could not be checked. Try signing in again.';
      notify();
    }
    try {
      if (session && sessionStorage.getItem(RETURN_TAB)) {
        sessionStorage.removeItem(RETURN_TAB);
        window.location.hash = '#draftsim';
      }
    } catch (_) {}
  }

  function getClient() {
    if (clientPromise) return clientPromise;
    clientPromise = new Promise((resolve,reject) => {
      const script = document.createElement('script');
      script.src = 'dlns/vendor/supabase-2.118.0.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('The sign-in client could not be loaded. Reload the page and try again.'));
      document.head.appendChild(script);
    }).then(async () => {
      client = window.supabase.createClient(URL,KEY,{
        auth:{flowType:'pkce',storageKey:AUTH_STORAGE,persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
      });
      client.auth.onAuthStateChange((_event,session) => {
        window.setTimeout(() => { refreshAuth(session).catch(reportAuthError); },0);
      });
      const {data,error} = await client.auth.getSession();
      if (error) throw error;
      await refreshAuth(data.session);
      return client;
    }).catch(error => {
      clientPromise = null;
      reportAuthError(error);
      throw error;
    });
    return clientPromise;
  }

  function reportAuthError(error) {
    auth.ready = true;
    auth.admin = false;
    auth.error = error.message || 'Sign-in failed. Please try again.';
    notify();
  }

  async function signIn() {
    if (window.location.protocol === 'file:') throw new Error('Open DLNS through the website or localhost to sign in.');
    try { sessionStorage.setItem(RETURN_TAB,'draftsim'); } catch (_) {}
    const sdk = await getClient();
    const redirectTo = window.location.origin + window.location.pathname;
    const {error} = await sdk.auth.signInWithOAuth({provider:'github',options:{redirectTo,scopes:'read:user user:email'}});
    if (error) throw error;
  }

  async function signOut() {
    const sdk = await getClient();
    const {error} = await sdk.auth.signOut({scope:'local'});
    if (error) throw error;
    await refreshAuth(null);
  }

  async function saveMatch(match,revision = null,originalId = null) {
    const errors = DLNSModel.validateMatch(match);
    if (errors.length) throw new Error(errors.join(' '));
    const sdk = await getClient();
    const {data,error} = await sdk.rpc('dlns_save_match',{
      p_match:match,p_expected_revision:revision,p_original_match_id:originalId
    });
    if (error) throw new Error(error.message);
    const saved = Array.isArray(data) ? data[0] : data;
    if (!saved?.match_id) throw new Error('The server did not confirm the saved match. Reload data before retrying.');
    remember([...matches.filter(item => item.match_id !== originalId && item.match_id !== saved.match_id),saved]);
    return saved;
  }

  window.DLNSDatabase = {
    loadMatches,readCache,signIn,signOut,saveMatch,
    get matches() { return matches; },
    get auth() { return {...auth}; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    initAuth() {
      let saved = false;
      try { saved = Boolean(localStorage.getItem(AUTH_STORAGE)); } catch (_) {}
      const params = new URLSearchParams(window.location.search);
      if (params.has('error_description')) reportAuthError(new Error(params.get('error_description')));
      if (saved || params.has('code')) {
        auth.ready = false;
        notify();
        getClient().catch(() => {});
      }
    }
  };
})();
