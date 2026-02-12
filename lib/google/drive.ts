import { callGoogleAPI } from "./tokens";
import type { Logger } from "@/lib/logging";

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

export interface DriveFile {
    id?: string;
    name: string;
    mimeType: string;
    parents?: string[];
    description?: string;
    webViewLink?: string;
    webContentLink?: string;
}

export interface DriveFolder {
    id?: string;
    name: string;
    parents?: string[];
    description?: string;
    webViewLink?: string;
}

/**
 * Create a folder in Google Drive
 */
export async function createFolder(
    accessToken: string,
    folderName: string,
    parentFolderId?: string,
    description?: string,
    log?: Logger
): Promise<DriveFolder> {
    const metadata: Record<string, unknown> = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
    };

    if (parentFolderId) {
        metadata.parents = [parentFolderId];
    }

    if (description) {
        metadata.description = description;
    }

    const queryParams = new URLSearchParams({
        fields: "id,name,parents,description,webViewLink",
    });

    const response = await callGoogleAPI<DriveFolder>(
        `${DRIVE_API_BASE}/files?${queryParams}`,
        accessToken,
        {
            method: 'POST',
            body: JSON.stringify(metadata),
        },
        log
    );

    return response;
}

/**
 * Upload a file to Google Drive
 */
export async function uploadFile(
    accessToken: string,
    fileName: string,
    mimeType: string,
    fileContent: string | Buffer,
    folderId?: string,
    log?: Logger
): Promise<DriveFile> {
    const metadata: Record<string, unknown> = {
        name: fileName,
        mimeType: mimeType,
    };

    if (folderId) {
        metadata.parents = [folderId];
    }

    // Convert content to base64 if it's a Buffer
    const base64Content = Buffer.isBuffer(fileContent)
        ? fileContent.toString('base64')
        : Buffer.from(fileContent).toString('base64');

    // Multipart upload
    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const multipartRequestBody =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        `Content-Type: ${mimeType}\r\n` +
        'Content-Transfer-Encoding: base64\r\n\r\n' +
        base64Content +
        closeDelimiter;

    log?.info("google.drive.upload", { fileName, mimeType });
    const response = await fetch(
        `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body: multipartRequestBody,
        }
    );

    if (!response.ok) {
        throw new Error(`File upload failed: ${response.statusText}`);
    }

    return response.json();
}

/**
 * List files in a folder
 */
export async function listFiles(
    accessToken: string,
    folderId?: string,
    pageSize: number = 10,
    log?: Logger
): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
    const queryParams = new URLSearchParams({
        pageSize: pageSize.toString(),
        fields: 'nextPageToken, files(id, name, mimeType, webViewLink, webContentLink)',
    });

    if (folderId) {
        queryParams.append('q', `'${folderId}' in parents and trashed=false`);
    } else {
        queryParams.append('q', 'trashed=false');
    }

    const response = await callGoogleAPI<{
        files: DriveFile[];
        nextPageToken?: string;
    }>(
        `${DRIVE_API_BASE}/files?${queryParams}`,
        accessToken,
        {},
        log
    );

    return response;
}

/**
 * Get file metadata
 */
export async function getFile(
    accessToken: string,
    fileId: string,
    log?: Logger
): Promise<DriveFile> {
    const queryParams = new URLSearchParams({
        fields: 'id, name, mimeType, parents, description, webViewLink, webContentLink',
    });

    const response = await callGoogleAPI<DriveFile>(
        `${DRIVE_API_BASE}/files/${fileId}?${queryParams}`,
        accessToken,
        {},
        log
    );

    return response;
}

/**
 * Share a file or folder with specific permissions
 */
export async function shareFile(
    accessToken: string,
    fileId: string,
    emailAddress: string,
    role: 'reader' | 'writer' | 'commenter' = 'reader',
    sendNotificationEmail: boolean = false,
    log?: Logger
): Promise<void> {
    const queryParams = new URLSearchParams({
        sendNotificationEmail: sendNotificationEmail.toString(),
    });

    await callGoogleAPI(
        `${DRIVE_API_BASE}/files/${fileId}/permissions?${queryParams}`,
        accessToken,
        {
            method: 'POST',
            body: JSON.stringify({
                type: 'user',
                role: role,
                emailAddress: emailAddress,
            }),
        },
        log
    );
}

/**
 * Make a file or folder publicly accessible
 */
export async function makePublic(
    accessToken: string,
    fileId: string,
    log?: Logger
): Promise<void> {
    await callGoogleAPI(
        `${DRIVE_API_BASE}/files/${fileId}/permissions`,
        accessToken,
        {
            method: 'POST',
            body: JSON.stringify({
                type: 'anyone',
                role: 'reader',
            }),
        },
        log
    );
}

/**
 * Delete a file or folder
 */
export async function deleteFile(
    accessToken: string,
    fileId: string,
    log?: Logger
): Promise<void> {
    await callGoogleAPI(
        `${DRIVE_API_BASE}/files/${fileId}`,
        accessToken,
        {
            method: 'DELETE',
        },
        log
    );
}

/**
 * Search for files by name or query
 */
export async function searchFiles(
    accessToken: string,
    query: string,
    pageSize: number = 10,
    log?: Logger
): Promise<DriveFile[]> {
    const queryParams = new URLSearchParams({
        q: `name contains '${query}' and trashed=false`,
        pageSize: pageSize.toString(),
        fields: 'files(id, name, mimeType, webViewLink)',
    });

    const response = await callGoogleAPI<{ files: DriveFile[] }>(
        `${DRIVE_API_BASE}/files?${queryParams}`,
        accessToken,
        {},
        log
    );

    return response.files || [];
}

/**
 * Create a client-specific folder structure
 */
export async function createClientFolder(
    accessToken: string,
    clientName: string,
    parentFolderId?: string,
    log?: Logger
): Promise<{
    mainFolder: DriveFolder;
    subfolders: {
        contracts: DriveFolder;
        proposals: DriveFolder;
        communications: DriveFolder;
    };
}> {
    // Create main client folder
    const mainFolder = await createFolder(
        accessToken,
        clientName,
        parentFolderId,
        `Client folder for ${clientName}`,
        log
    );

    // Create sub-folders
    const [contracts, proposals, communications] = await Promise.all([
        createFolder(accessToken, 'Contracts', mainFolder.id, undefined, log),
        createFolder(accessToken, 'Proposals', mainFolder.id, undefined, log),
        createFolder(accessToken, 'Communications', mainFolder.id, undefined, log),
    ]);

    return {
        mainFolder,
        subfolders: {
            contracts,
            proposals,
            communications,
        },
    };
}
