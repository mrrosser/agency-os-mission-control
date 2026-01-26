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
if (missingConfig.length > 0) {
    throw new Error(`Missing Firebase config values: ${missingConfig.map(([key]) => key).join(", ")}`);
}

// Initialize Firebase (Singleton)
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);

// Configure Google Provider with OAuth Scopes
const googleProvider = new GoogleAuthProvider();

// Add OAuth scopes for Google services
googleProvider.addScope('https://www.googleapis.com/auth/calendar');        // Calendar access
googleProvider.addScope('https://www.googleapis.com/auth/calendar.events');  // Calendar events
googleProvider.addScope('https://www.googleapis.com/auth/gmail.readonly');   // Gmail read access
googleProvider.addScope('https://www.googleapis.com/auth/gmail.send');       // Gmail send access
googleProvider.addScope('https://www.googleapis.com/auth/drive.readonly');   // Drive read access
googleProvider.addScope('https://www.googleapis.com/auth/drive.file');       // Drive file access

// Additional recommended scopes for a complete agency platform
googleProvider.addScope('https://www.googleapis.com/auth/contacts.readonly'); // Contacts access
googleProvider.addScope('https://www.googleapis.com/auth/userinfo.email');    // User email
googleProvider.addScope('https://www.googleapis.com/auth/userinfo.profile');  // User profile

// Ensure user is prompted to select account only when needed
googleProvider.setCustomParameters({
    prompt: 'consent'
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
