import { db } from "./firebase";
import {
    collection,
    doc,
    setDoc,
    getDoc,
    getDocs,
    query,
    where,
    orderBy,
    limit,
    addDoc,
    serverTimestamp,
    type DocumentData
} from "firebase/firestore";

export interface Lead {
    id?: string;
    userId: string;
    name: string;
    email: string;
    company?: string;
    phone?: string;
    website?: string;
    industry?: string;
    score?: number;
    source?: string;
    status: 'new' | 'contacted' | 'meeting' | 'closed' | 'lost';
    createdAt: any;
}

export interface ActivityLog {
    userId: string;
    action: string;
    details?: string;
    type: 'email' | 'meeting' | 'lead' | 'system';
    timestamp: any;
}

export const dbService = {
    // Leads
    async getLeads(userId: string) {
        const q = query(collection(db, "leads"), where("userId", "==", userId), orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Lead));
    },

    async addLead(lead: Omit<Lead, 'id' | 'createdAt'>) {
        return addDoc(collection(db, "leads"), {
            ...lead,
            createdAt: serverTimestamp()
        });
    },

    // Activities
    async logActivity(activity: Omit<ActivityLog, 'timestamp'>) {
        return addDoc(collection(db, "activities"), {
            ...activity,
            timestamp: serverTimestamp()
        });
    },

    async getRecentActivities(userId: string, limitCount = 10) {
        const q = query(
            collection(db, "activities"),
            where("userId", "==", userId),
            orderBy("timestamp", "desc"),
            limit(limitCount)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },

    // Analytics
    async getAnalytics(userId: string) {
        const docRef = doc(db, "analytics", userId);
        const docSnap = await getDoc(docRef);
        return docSnap.exists() ? docSnap.data() : null;
    },

    // Users
    async syncUser(user: any) {
        if (!user || !user.uid) return;

        const userRef = doc(db, "users", user.uid);
        const userData = {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            providerId: user.providerData?.[0]?.providerId || 'password',
            lastLogin: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        try {
            await setDoc(userRef, userData, { merge: true });
        } catch (error: any) {
            console.warn("SyncUser failed initially, retrying...", error);
            // Retry once after a small delay to allow Auth to propagate
            await new Promise(resolve => setTimeout(resolve, 1000));
            await setDoc(userRef, userData, { merge: true });
        }
    }
};
