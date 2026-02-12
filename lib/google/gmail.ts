import { callGoogleAPI } from "./tokens";
import type { Logger } from "@/lib/logging";

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    if (items.length === 0) return [];

    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        for (let index = nextIndex++; index < items.length; index = nextIndex++) {
            results[index] = await fn(items[index]);
        }
    });

    await Promise.all(workers);
    return results;
}

function buildInboxMessageMetadataQuery(): string {
    const params = new URLSearchParams({
        format: "metadata",
        // Keep response small (avoid full bodies/attachments in the inbox list).
        fields: "id,threadId,labelIds,snippet,internalDate,payload(headers)",
    });

    for (const header of ["From", "To", "Subject", "Date"]) {
        params.append("metadataHeaders", header);
    }

    return params.toString();
}

export interface EmailMessage {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    isHtml?: boolean;
    attachments?: Array<{
        filename: string;
        mimeType: string;
        data: string; // base64 encoded
    }>;
}

export interface GmailMessage {
    id: string;
    threadId: string;
    labelIds?: string[];
    snippet: string;
    payload?: {
        headers: Array<{ name: string; value: string }>;
        body?: { data?: string };
        parts?: GmailMessagePart[];
    };
    internalDate?: string;
}

export interface GmailMessagePart {
    mimeType?: string;
    filename?: string;
    headers?: Array<{ name: string; value: string }>;
    body?: {
        size?: number;
        data?: string;
        attachmentId?: string;
    };
    parts?: GmailMessagePart[];
}

/**
 * Send an email via Gmail API
 */
export async function sendEmail(
    accessToken: string,
    email: EmailMessage,
    log?: Logger
): Promise<{ id: string; threadId: string }> {
    // Build the email in RFC 2822 format
    const messageParts: string[] = [];

    // To
    messageParts.push(`To: ${email.to.join(', ')}`);

    // CC
    if (email.cc && email.cc.length > 0) {
        messageParts.push(`Cc: ${email.cc.join(', ')}`);
    }

    // Subject
    messageParts.push(`Subject: ${email.subject}`);

    // Content-Type
    const contentType = email.isHtml ? 'text/html' : 'text/plain';
    messageParts.push(`Content-Type: ${contentType}; charset=utf-8`);
    messageParts.push('');

    // Body
    messageParts.push(email.body);

    // Build the raw message
    const rawMessage = messageParts.join('\r\n');
    const encodedMessage = Buffer.from(rawMessage)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    const response = await callGoogleAPI<{ id: string; threadId: string }>(
        `${GMAIL_API_BASE}/users/me/messages/send`,
        accessToken,
        {
            method: 'POST',
            body: JSON.stringify({
                raw: encodedMessage,
            }),
        },
        log
    );

    return response;
}

/**
 * Create a Gmail draft (no send).
 */
export async function createDraftEmail(
    accessToken: string,
    email: EmailMessage,
    log?: Logger
): Promise<{ draftId: string; messageId: string; threadId?: string }> {
    const messageParts: string[] = [];

    messageParts.push(`To: ${email.to.join(', ')}`);

    if (email.cc && email.cc.length > 0) {
        messageParts.push(`Cc: ${email.cc.join(', ')}`);
    }

    messageParts.push(`Subject: ${email.subject}`);

    const contentType = email.isHtml ? 'text/html' : 'text/plain';
    messageParts.push(`Content-Type: ${contentType}; charset=utf-8`);
    messageParts.push('');
    messageParts.push(email.body);

    const rawMessage = messageParts.join('\r\n');
    const encodedMessage = Buffer.from(rawMessage)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    const response = await callGoogleAPI<{
        id: string;
        message?: { id?: string; threadId?: string };
    }>(
        `${GMAIL_API_BASE}/users/me/drafts`,
        accessToken,
        {
            method: 'POST',
            body: JSON.stringify({
                message: { raw: encodedMessage },
            }),
        },
        log
    );

    return {
        draftId: response.id,
        messageId: response.message?.id || response.id,
        threadId: response.message?.threadId,
    };
}

/**
 * Get inbox messages (with pagination)
 */
export async function getInboxMessages(
    accessToken: string,
    maxResults: number = 10,
    pageToken?: string,
    log?: Logger
): Promise<{ messages: GmailMessage[]; nextPageToken?: string }> {
    const queryParams = new URLSearchParams({
        maxResults: maxResults.toString(),
        labelIds: 'INBOX',
        fields: "messages(id,threadId),nextPageToken",
    });

    if (pageToken) {
        queryParams.append('pageToken', pageToken);
    }

    const response = await callGoogleAPI<{
        messages?: Array<{ id: string; threadId: string }>;
        nextPageToken?: string;
    }>(
        `${GMAIL_API_BASE}/users/me/messages?${queryParams}`,
        accessToken,
        {},
        log
    );

    if (!response.messages || response.messages.length === 0) {
        return { messages: [] };
    }

    const metadataQuery = buildInboxMessageMetadataQuery();

    // Fetch message metadata with bounded concurrency to avoid memory spikes on small instances.
    const messages = await mapWithConcurrency(response.messages, 5, (msg) =>
        callGoogleAPI<GmailMessage>(
            `${GMAIL_API_BASE}/users/me/messages/${msg.id}?${metadataQuery}`,
            accessToken,
            {},
            log
        )
    );

    return {
        messages,
        nextPageToken: response.nextPageToken,
    };
}

/**
 * Get a specific message by ID
 */
export async function getMessage(
    accessToken: string,
    messageId: string,
    log?: Logger
): Promise<GmailMessage> {
    return callGoogleAPI<GmailMessage>(
        `${GMAIL_API_BASE}/users/me/messages/${messageId}`,
        accessToken,
        {},
        log
    );
}

/**
 * Get an email thread
 */
export async function getThread(
    accessToken: string,
    threadId: string,
    log?: Logger
): Promise<{ messages: GmailMessage[] }> {
    const response = await callGoogleAPI<{ messages: GmailMessage[] }>(
        `${GMAIL_API_BASE}/users/me/threads/${threadId}`,
        accessToken,
        {},
        log
    );

    return response;
}

/**
 * Reply to an email
 */
export async function replyToMessage(
    accessToken: string,
    originalMessageId: string,
    threadId: string,
    replyBody: string,
    isHtml: boolean = false,
    log?: Logger
): Promise<{ id: string; threadId: string }> {
    // Get original message to extract headers
    const originalMessage = await getMessage(accessToken, originalMessageId, log);

    const headers = originalMessage.payload?.headers || [];
    const fromHeader = headers.find(h => h.name === 'From')?.value || '';
    const subjectHeader = headers.find(h => h.name === 'Subject')?.value || '';

    // Build reply
    const messageParts: string[] = [];
    messageParts.push(`To: ${fromHeader}`);
    messageParts.push(`Subject: Re: ${subjectHeader.replace(/^Re: /, '')}`);
    messageParts.push(`In-Reply-To: ${originalMessageId}`);
    messageParts.push(`References: ${originalMessageId}`);

    const contentType = isHtml ? 'text/html' : 'text/plain';
    messageParts.push(`Content-Type: ${contentType}; charset=utf-8`);
    messageParts.push('');
    messageParts.push(replyBody);

    const rawMessage = messageParts.join('\r\n');
    const encodedMessage = Buffer.from(rawMessage)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    const response = await callGoogleAPI<{ id: string; threadId: string }>(
        `${GMAIL_API_BASE}/users/me/messages/send`,
        accessToken,
        {
            method: 'POST',
            body: JSON.stringify({
                raw: encodedMessage,
                threadId: threadId,
            }),
        },
        log
    );

    return response;
}

/**
 * Search for emails matching a query
 */
export async function searchEmails(
    accessToken: string,
    query: string,
    maxResults: number = 10,
    log?: Logger
): Promise<GmailMessage[]> {
    const queryParams = new URLSearchParams({
        q: query,
        maxResults: maxResults.toString(),
    });

    const response = await callGoogleAPI<{
        messages?: Array<{ id: string; threadId: string }>;
    }>(
        `${GMAIL_API_BASE}/users/me/messages?${queryParams}`,
        accessToken,
        {},
        log
    );

    if (!response.messages || response.messages.length === 0) {
        return [];
    }

    // Get full message details
    const messages = await Promise.all(
        response.messages.map(msg =>
            callGoogleAPI<GmailMessage>(
                `${GMAIL_API_BASE}/users/me/messages/${msg.id}`,
                accessToken,
                {},
                log
            )
        )
    );

    return messages;
}

/**
 * Mark message as read
 */
export async function markAsRead(
    accessToken: string,
    messageId: string,
    log?: Logger
): Promise<void> {
    await callGoogleAPI(
        `${GMAIL_API_BASE}/users/me/messages/${messageId}/modify`,
        accessToken,
        {
            method: 'POST',
            body: JSON.stringify({
                removeLabelIds: ['UNREAD'],
            }),
        },
        log
    );
}

/**
 * Extract email body from Gmail message
 */
export function extractEmailBody(message: GmailMessage): string {
    if (message.payload?.body?.data) {
        return Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
    }

    // Check parts for multipart messages
    if (message.payload?.parts) {
        for (const part of message.payload.parts) {
            if (part.mimeType === 'text/plain' && part.body?.data) {
                return Buffer.from(part.body.data, 'base64').toString('utf-8');
            }
        }
    }

    return message.snippet || '';
}
