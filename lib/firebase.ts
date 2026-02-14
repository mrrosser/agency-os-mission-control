import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const missingConfig = Object.entries(firebaseConfig).filter(([, value]) => !value);
const allowMissingConfig =
    process.env.CI === "true" ||
    process.env.NODE_ENV === "test" ||
    process.env.NEXT_PHASE === "phase-production-build";

if (missingConfig.length > 0 && !allowMissingConfig) {
    throw new Error(`Missing Firebase config values: ${missingConfig.map(([key]) => key).join(", ")}`);
}

const placeholderConfig = {
    apiKey: "missing",
    authDomain: "missing.firebaseapp.com",
    projectId: "missing",
    storageBucket: "missing.appspot.com",
    messagingSenderId: "0000000000",
    appId: "1:0000000000:web:missing",
};

const configForInit = missingConfig.length > 0 ? placeholderConfig : firebaseConfig;

// Initialize Firebase (Singleton)
const app = !getApps().length ? initializeApp(configForInit) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);

// Google sign-in provider for app authentication only.
// Gmail/Drive/Calendar scopes are requested via the dedicated /api/google/connect flow.
const googleProvider = new GoogleAuthProvider();

// Ensure user is prompted to select account only when needed
googleProvider.setCustomParameters({
    prompt: 'select_account'
});

export { app, auth, db, googleProvider };
export {
    OAuthProvider,
    EmailAuthProvider,
    PhoneAuthProvider,
    RecaptchaVerifier,
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPhoneNumber,
    linkWithPhoneNumber,
    updateProfile
} from "firebase/auth";
