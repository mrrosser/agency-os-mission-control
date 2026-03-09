import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import {
    type FirebaseClientConfig,
    findMissingFirebaseClientConfig,
    resolveFirebaseClientConfig,
} from "@/lib/firebase-client-config";

declare global {
    interface Window {
        __LEADFLOW_FIREBASE_CONFIG__?: Partial<FirebaseClientConfig>;
    }
}

function getInjectedFirebaseConfig() {
    if (typeof window === "undefined") return undefined;
    return window.__LEADFLOW_FIREBASE_CONFIG__;
}

const firebaseConfig = resolveFirebaseClientConfig({
    env: process.env,
    defaultsJson: process.env.__FIREBASE_DEFAULTS__,
    injected: getInjectedFirebaseConfig(),
});

const missingConfig = findMissingFirebaseClientConfig(firebaseConfig);
const allowMissingConfig = process.env.NODE_ENV === "test" || typeof window === "undefined";

if (missingConfig.length > 0 && !allowMissingConfig) {
    throw new Error(`Missing Firebase config values: ${missingConfig.join(", ")}`);
}

const placeholderConfig = {
    apiKey: "missing",
    authDomain: "missing.firebaseapp.com",
    projectId: "missing",
    storageBucket: "missing.appspot.com",
    messagingSenderId: "0000000000",
    appId: "1:0000000000:web:missing",
};

const configForInit = missingConfig.length > 0 ? placeholderConfig : (firebaseConfig as FirebaseClientConfig);

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
