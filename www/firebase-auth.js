/* ===== CINDY — Firebase Auth Gate =====
 * Shows a Google Sign-in screen before the game boots. app.js's own
 * init() is gated on window.__cindyAuthReady (see the bottom of app.js) —
 * that promise only resolves once we have a signed-in user, so the game
 * logic never runs for a logged-out player.
 *
 * Works in two modes:
 *  - Native (Android/iOS via Capacitor): uses the real native Google
 *    Sign-In through @capacitor-firebase/authentication, then hands the
 *    credential to the Firebase JS SDK so firebase.auth().onAuthStateChanged
 *    fires normally. This is required because Google blocks OAuth popups
 *    opened from inside an app's WebView.
 *  - Web (browser preview / testing): falls back to firebase.auth()'s
 *    normal signInWithPopup, exactly like before.
 */
(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyBl33V6Ub_4N4E4qOjigmb6hxmi2cW3KIQ",
    authDomain: "cindy-2ebab.firebaseapp.com",
    projectId: "cindy-2ebab",
    storageBucket: "cindy-2ebab.firebasestorage.app",
    messagingSenderId: "1093035797902",
    appId: "1:1093035797902:web:93bd7f6687b2c3622b48df",
    measurementId: "G-RRC05Y34H1"
  };

  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();

  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  // On native, @capacitor-firebase/authentication registers itself as
  // window.Capacitor.Plugins.FirebaseAuthentication once npx cap sync has run.
  const NativeAuth = isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.FirebaseAuthentication;

  let resolveAuthReady;
  window.__cindyAuthReady = new Promise((resolve) => { resolveAuthReady = resolve; });
  window.__cindyResolveAuthReady = resolveAuthReady;

  function els() {
    return {
      loginScreen: document.getElementById('loginScreen'),
      btn: document.getElementById('googleLoginBtn'),
      msg: document.getElementById('loginMsg')
    };
  }

  function showMsg(text) {
    const { msg } = els();
    if (msg) msg.textContent = text || '';
  }

  function translateError(code) {
    const map = {
      'auth/popup-closed-by-user': 'ปิดหน้าต่างล็อกอินก่อนเลือกบัญชี ลองใหม่อีกครั้ง',
      'auth/popup-blocked': 'เบราว์เซอร์บล็อก popup กรุณาอนุญาต popup แล้วลองใหม่',
      'auth/cancelled-popup-request': 'มีการเปิด popup ซ้ำ กรุณาลองใหม่',
      'auth/account-exists-with-different-credential': 'อีเมลนี้เคยสมัครด้วยวิธีอื่นแล้ว',
      'auth/network-request-failed': 'การเชื่อมต่ออินเทอร์เน็ตมีปัญหา กรุณาลองใหม่',
      'auth/unauthorized-domain': 'โดเมนนี้ยังไม่ได้รับอนุญาตใน Firebase Console (Authentication > Settings > Authorized domains)'
    };
    return map[code] || ('เข้าสู่ระบบไม่สำเร็จ: ' + code);
  }

  async function loginNative() {
    const { btn } = els();
    if (btn) btn.disabled = true;
    showMsg('');
    try {
      // 1. Real native Google Sign-In (Android/iOS system UI, no WebView popup).
      const result = await NativeAuth.signInWithGoogle();
      const idToken = result.credential && result.credential.idToken;
      const accessToken = result.credential && result.credential.accessToken;
      if (!idToken) throw new Error('no-id-token');

      // 2. Hand the native credential to the Firebase JS SDK so
      //    firebase.auth().onAuthStateChanged fires like on the web.
      const credential = firebase.auth.GoogleAuthProvider.credential(idToken, accessToken);
      await auth.signInWithCredential(credential);
    } catch (err) {
      console.error('[auth] native google sign-in failed:', err);
      showMsg('เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function loginWeb() {
    const { btn } = els();
    if (btn) btn.disabled = true;
    showMsg('');
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
      .catch((err) => showMsg(translateError(err.code)))
      .finally(() => { if (btn) btn.disabled = false; });
  }

  window.cindyLoginWithGoogle = function () {
    if (NativeAuth) loginNative(); else loginWeb();
  };

  window.cindyLogout = function () {
    if (NativeAuth) NativeAuth.signOut().catch(() => {});
    auth.signOut();
  };

  let handledFirstState = false;
  auth.onAuthStateChanged((user) => {
    const { loginScreen } = els();
    if (user) {
      window.cindyUser = { uid: user.uid, name: user.displayName, email: user.email, photo: user.photoURL };
      if (loginScreen) loginScreen.classList.remove('show');
      // __cindyAuthReady is resolved by firestore-sync.js instead of here —
      // it needs to pull the player's cloud data into localStorage first,
      // so app.js's init() only ever sees fully-synced data.
    } else {
      window.cindyUser = null;
      if (loginScreen) loginScreen.classList.add('show');
      // Do NOT resolve __cindyAuthReady here — the game must wait for login.
    }
  });
})();

