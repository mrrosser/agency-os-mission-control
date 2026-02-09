import { db } from "../firebase";
import { doc, getDoc, setDoc, updateDoc, collection, addDoc, serverTimestamp, query, orderBy, limit, getDocs } from "firebase/firestore";

export interface UserPreferences {
    theme: "light" | "dark";
    notifications: boolean;
    autoPilotEnabled: boolean;
    lastIntegrationSync: unknown;
}

const DEFAULT_PREFS: UserPreferences = {
    theme: "dark",
    notifications: true,
    autoPilotEnabled: false,
    lastIntegrationSync: null
};

/**
 * Gets or initializes user preferences in Firestore.
 */
export async function getUserPreferences(uid: string): Promise<UserPreferences> {
    const ref = doc(db, "user_preferences", uid);
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data() as UserPreferences;

    await setDoc(ref, DEFAULT_PREFS);
    return DEFAULT_PREFS;
}

/**
 * Persist user changes to their "Memory".
 */
export async function updateUserPreferences(uid: string, updates: Partial<UserPreferences>) {
    const ref = doc(db, "user_preferences", uid);
    await updateDoc(ref, { ...updates, updatedAt: serverTimestamp() });
}

/**
 * Enterprise Audit Logging: Every sensitive action is persisted with a timestamp.
 */
export async function logSecurityEvent(uid: string, event: string, metadata: Record<string, unknown> | null) {
    const logRef = collection(db, "security_audit_logs");
    await addDoc(logRef, {
        uid,
        event,
        metadata,
        timestamp: serverTimestamp()
    });
}

/**
 * Retrieves the latest audit logs for the dashboard.
 */
export async function getAuditLogs(uid: string, count: number = 10) {
    const q = query(
        collection(db, "security_audit_logs"),
        orderBy("timestamp", "desc"),
        limit(count)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
