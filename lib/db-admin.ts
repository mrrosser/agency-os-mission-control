import { getAdminDb } from "./firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export interface ActivityLog {
    userId: string;
    action: string;
    details?: string;
    type: 'email' | 'meeting' | 'lead' | 'system' | 'calendar';
    timestamp: unknown;
}

export const dbAdmin = {
    async logActivity(activity: Omit<ActivityLog, 'timestamp'>) {
        return getAdminDb().collection("activities").add({
            ...activity,
            timestamp: FieldValue.serverTimestamp()
        });
    },

    async updateAnalytics(userId: string, data: Partial<{
        totalLeads: number;
        converted: number;
        conversionRate: number;
        emailsSent: number;
        meetingsScheduled: number;
    }>) {
        return getAdminDb().collection("analytics").doc(userId).set(data, { merge: true });
    }
};
