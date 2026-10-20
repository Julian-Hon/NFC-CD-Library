const authConfig = window.DIGITAL_CD_LIBRARY_SUPABASE;
const authControls = document.querySelector('#auth-controls');
const authDialog = document.querySelector('#auth-dialog');
const authForm = document.querySelector('#auth-form');
const authStatus = document.querySelector('#auth-status');
const authSubmit = document.querySelector('#auth-submit');
const authToggle = document.querySelector('#auth-toggle');
let signingUp = false;

function setAuthStatus(message, isError = false) {
  authStatus.textContent = message;
  authStatus.classList.toggle('error', isError);
}

function setAuthMode(signUp) {
  signingUp = signUp;
  document.querySelector('#auth-title').textContent = signUp ? 'Create account' : 'Sign in';
  authSubmit.textContent = signUp ? 'Create account' : 'Sign in';
  authToggle.textContent = signUp ? 'Already have an account? Sign in' : 'Need an account? Sign up';
  document.querySelector('#auth-password').autocomplete = signUp ? 'new-password' : 'current-password';
  setAuthStatus('');
}

function renderAuthUser(user) {
  document.querySelector('#auth-open').hidden = Boolean(user);
  document.querySelector('#auth-sign-out').hidden = !user;
  const name = document.querySelector('#auth-user');
  name.hidden = !user;
  name.textContent = user?.email || '';
  document.querySelector('#auth-storage-note').hidden = !user;
  if (user && authDialog.open) authDialog.close();
}

if (authConfig?.url && authConfig?.publishableKey) {
  authControls.hidden = false;
  if (!window.supabase?.createClient) {
    document.querySelector('#auth-open').disabled = true;
    document.querySelector('#auth-open').textContent = 'Sign-in unavailable';
  } else {
    const authClient = window.supabase.createClient(authConfig.url, authConfig.publishableKey);
    authClient.auth.onAuthStateChange((_event, session) => {
      renderAuthUser(session?.user || null);
    });

    document.querySelector('#auth-open').addEventListener('click', () => {
      setAuthMode(false);
      authDialog.showModal();
      document.querySelector('#auth-email').focus();
    });
    document.querySelector('#auth-close').addEventListener('click', () => authDialog.close());
    authToggle.addEventListener('click', () => setAuthMode(!signingUp));
    document.querySelector('#auth-sign-out').addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      const { error } = await authClient.auth.signOut({ scope: 'local' });
      event.currentTarget.disabled = false;
      if (error) alert(error.message);
    });
    authForm.addEventListener('submit', async event => {
      event.preventDefault();
      authSubmit.disabled = true;
      setAuthStatus(signingUp ? 'Creating your account…' : 'Signing in…');
      const email = document.querySelector('#auth-email').value.trim();
      const password = document.querySelector('#auth-password').value;
      try {
        const { data, error } = signingUp
          ? await authClient.auth.signUp({
              email, password,
              options: { emailRedirectTo: location.origin + location.pathname }
            })
          : await authClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (signingUp && !data.session) {
          setAuthStatus('Check your email to confirm your account, then return here to sign in.');
        } else {
          authDialog.close();
        }
      } catch (error) {
        setAuthStatus(error.message || 'Sign-in failed. Please try again.', true);
      } finally {
        authSubmit.disabled = false;
      }
    });
  }
}
