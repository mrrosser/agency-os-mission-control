import { createHash } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

type DocumentData = Record<string, unknown>;
type DocumentReference = {
  kind: "document";
  id: string;
  path: string;
  get: () => Promise<DocumentSnapshot>;
  set: (data: DocumentData, options?: { merge?: boolean }) => Promise<void>;
  delete: () => Promise<void>;
  collection: (name: string) => CollectionReference;
};
type CollectionReference = {
  kind: "collection";
  path: string;
  doc: (id: string) => DocumentReference;
  where: (field: string, operator: "==", value: unknown) => QueryReference;
};
type QueryReference = {
  kind: "query";
  path: string;
  field: string;
  value: unknown;
  maximum: number | null;
  limit: (maximum: number) => QueryReference;
};
type DocumentSnapshot = {
  exists: boolean;
  id: string;
  data: () => DocumentData | undefined;
};
type QuerySnapshot = { docs: DocumentSnapshot[] };

const firestore = vi.hoisted(() => {
  const documents = new Map<string, Record<string, unknown>>();
  const secrets = new Map<string, string>();
  const DELETE_FIELD = Symbol("firestore-delete-field");
  const SERVER_TIMESTAMP = Symbol("firestore-server-timestamp");

  const clone = (value: Record<string, unknown>) => ({ ...value });

  const snapshot = (path: string): DocumentSnapshot => {
    const value = documents.get(path);
    return {
      exists: value !== undefined,
      id: path.split("/").at(-1) || "",
      data: () => (value === undefined ? undefined : clone(value)),
    };
  };

  const applySet = (
    path: string,
    data: Record<string, unknown>,
    options?: { merge?: boolean }
  ) => {
    const next = options?.merge ? clone(documents.get(path) || {}) : {};
    for (const [key, value] of Object.entries(data)) {
      if (value === DELETE_FIELD) delete next[key];
      else next[key] = value;
    }
    documents.set(path, next);
  };

  const makeQuery = (
    path: string,
    field: string,
    value: unknown,
    maximum: number | null = null
  ): QueryReference => ({
    kind: "query",
    path,
    field,
    value,
    maximum,
    limit: (nextMaximum: number) =>
      makeQuery(path, field, value, nextMaximum),
  });

  const makeCollection = (path: string): CollectionReference => ({
    kind: "collection",
    path,
    doc: (id: string) => makeDocument(`${path}/${id}`),
    where: (field: string, operator: "==", value: unknown) => {
      if (operator !== "==") throw new Error(`Unsupported operator ${operator}`);
      return makeQuery(path, field, value);
    },
  });

  const makeDocument = (path: string): DocumentReference => ({
    kind: "document",
    path,
    id: path.split("/").at(-1) || "",
    get: async () => snapshot(path),
    set: async (data, options) => applySet(path, data, options),
    delete: async () => {
      documents.delete(path);
    },
    collection: (name: string) => makeCollection(`${path}/${name}`),
  });

  const querySnapshot = (query: QueryReference): QuerySnapshot => {
    const prefix = `${query.path}/`;
    const docs = [...documents.entries()]
      .filter(([path, data]) => {
        const suffix = path.startsWith(prefix) ? path.slice(prefix.length) : "";
        return Boolean(suffix) && !suffix.includes("/") && data[query.field] === query.value;
      })
      .map(([path]) => snapshot(path));
    return { docs: query.maximum === null ? docs : docs.slice(0, query.maximum) };
  };

  const runTransactionMock = vi.fn(
    async <T>(
      callback: (transaction: {
        get: (
          reference: DocumentReference | QueryReference
        ) => Promise<DocumentSnapshot | QuerySnapshot>;
        set: (
          reference: DocumentReference,
          data: DocumentData,
          options?: { merge?: boolean }
        ) => void;
        create: (reference: DocumentReference, data: DocumentData) => void;
        delete: (reference: DocumentReference) => void;
      }) => Promise<T>
    ): Promise<T> => {
      const mutations: Array<() => void> = [];
      const result = await callback({
        get: async (reference) =>
          reference.kind === "query"
            ? querySnapshot(reference)
            : snapshot(reference.path),
        set: (reference, data, options) => {
          mutations.push(() => applySet(reference.path, data, options));
        },
        create: (reference, data) => {
          if (documents.has(reference.path)) {
            throw new Error(`Document already exists: ${reference.path}`);
          }
          mutations.push(() => applySet(reference.path, data));
        },
        delete: (reference) => {
          mutations.push(() => documents.delete(reference.path));
        },
      });
      for (const mutate of mutations) mutate();
      return result;
    }
  );

  const getAdminDbMock = vi.fn(() => ({
    collection: (name: string) => makeCollection(name),
    runTransaction: runTransactionMock,
  }));
  const accessUserSecretMock = vi.fn(
    async (uid: string, name: string) => secrets.get(`${uid}:${name}`)
  );
  const setUserSecretMock = vi.fn(
    async (uid: string, name: string, value: string) => {
      secrets.set(`${uid}:${name}`, value);
    }
  );
  const deleteUserSecretMock = vi.fn(async (uid: string, name: string) => {
    secrets.delete(`${uid}:${name}`);
  });

  return {
    documents,
    secrets,
    DELETE_FIELD,
    SERVER_TIMESTAMP,
    runTransactionMock,
    getAdminDbMock,
    accessUserSecretMock,
    setUserSecretMock,
    deleteUserSecretMock,
  };
});

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    delete: () => firestore.DELETE_FIELD,
    serverTimestamp: () => firestore.SERVER_TIMESTAMP,
  },
}));

vi.mock("@/lib/secret-manager", () => ({
  accessUserSecret: firestore.accessUserSecretMock,
  setUserSecret: firestore.setUserSecretMock,
  deleteUserSecret: firestore.deleteUserSecretMock,
}));

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: firestore.getAdminDbMock,
}));

import {
  beginGoogleAccountProfileDisconnect,
  finishGoogleAccountProfileDisconnect,
  getGoogleDefaultProfileId,
  GoogleAccountProfileConflictError,
  GoogleAccountProfileReplacementRequiresDisconnectError,
  persistGoogleAccountProfileTokens,
  persistGoogleAccountTokenFailure,
  persistGoogleAccountTokens,
  resolveGoogleAccountTokens,
  setGoogleDefaultProfileId,
} from "@/lib/google/account-token-store";

const UID = "uid-1";
const REGISTRY_PATH = `google_oauth_tokens/${UID}`;

function registryPath(uid = UID) {
  return `google_oauth_tokens/${uid}`;
}

function bindingPath(profileId: string, uid = UID) {
  return `${registryPath(uid)}/profile_bindings/${profileId}`;
}

function accountPath(accountId: string, uid = UID) {
  return `${registryPath(uid)}/accounts/${accountId}`;
}

function accountIdForSubject(subject: string, uid = UID) {
  const digest = createHash("sha256")
    .update(`${uid.length}:${uid}:${subject.length}:${subject}`, "utf8")
    .digest("hex")
    .slice(0, 48);
  return `google-${digest}`;
}

function seedDocument(path: string, data: DocumentData) {
  firestore.documents.set(path, { ...data });
}

function seedAccount(
  profileId: string,
  accountId: string,
  tokens: DocumentData,
  accountData: DocumentData = {},
  uid = UID
) {
  seedDocument(bindingPath(profileId, uid), { accountId });
  seedDocument(accountPath(accountId, uid), {
    pendingRevocation: false,
    credentialWriteOperationId: null,
    ...accountData,
  });
  firestore.secrets.set(
    `${uid}:google-oauth-account-${accountId}`,
    JSON.stringify(tokens)
  );
}

const RT_PROFILE = "rt_solutions_work";
const ROSSER_PROFILE = "rosser_gallery_work";
const RT_SUBJECT = "google-subject-123";
const GMAIL_SEND_SCOPE =
  "email https://www.googleapis.com/auth/gmail.send openid";
const CORE_SCOPE = [
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly",
  "openid",
].join(" ");
const FULL_SCOPE = [
  CORE_SCOPE,
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
].join(" ");
const TOKEN_RECORD = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiryDate: 9_999_999_999_999,
  scope: GMAIL_SEND_SCOPE,
  scopePreset: "gmail_send" as const,
  tokenType: "Bearer",
  accountEmail: "sender@example.com",
  accountSubject: RT_SUBJECT,
};

describe("Google account token store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestore.documents.clear();
    firestore.secrets.clear();
    firestore.accessUserSecretMock.mockImplementation(
      async (uid: string, name: string) => firestore.secrets.get(`${uid}:${name}`)
    );
    firestore.setUserSecretMock.mockImplementation(
      async (uid: string, name: string, value: string) => {
        firestore.secrets.set(`${uid}:${name}`, value);
      }
    );
    firestore.deleteUserSecretMock.mockImplementation(
      async (uid: string, name: string) => {
        firestore.secrets.delete(`${uid}:${name}`);
      }
    );
  });

  it("fails closed for a schema-v2 registry without an explicit default", async () => {
    seedDocument(REGISTRY_PATH, {
      schemaVersion: 2,
      accessToken: "legacy-access-token",
      refreshToken: "legacy-refresh-token",
    });
    seedAccount(RT_PROFILE, "rt-account", TOKEN_RECORD);

    await expect(resolveGoogleAccountTokens(UID)).resolves.toEqual({
      registryFound: true,
      profileMapped: false,
      record: null,
    });
    expect(firestore.accessUserSecretMock).not.toHaveBeenCalled();
  });

  it("selects and resolves exactly the explicit default profile", async () => {
    seedDocument(REGISTRY_PATH, { schemaVersion: 2 });
    seedAccount(RT_PROFILE, "rt-account", TOKEN_RECORD);
    seedAccount(ROSSER_PROFILE, "rosser-account", {
      ...TOKEN_RECORD,
      accessToken: "rosser-access-token",
      refreshToken: "rosser-refresh-token",
      accountEmail: "gallery@example.com",
      accountSubject: "rosser-google-subject",
    });

    await expect(setGoogleDefaultProfileId(UID, ROSSER_PROFILE)).resolves.toBe(
      ROSSER_PROFILE
    );
    await expect(getGoogleDefaultProfileId(UID)).resolves.toBe(ROSSER_PROFILE);
    const resolution = await resolveGoogleAccountTokens(UID);

    expect(resolution).toMatchObject({
      registryFound: true,
      profileMapped: true,
      record: {
        accountId: "rosser-account",
        profileId: ROSSER_PROFILE,
        tokens: {
          accessToken: "rosser-access-token",
          refreshToken: "rosser-refresh-token",
        },
      },
    });
    expect(firestore.accessUserSecretMock).toHaveBeenCalledOnce();
    expect(firestore.accessUserSecretMock).toHaveBeenCalledWith(
      UID,
      "google-oauth-account-rosser-account"
    );
  });

  it("rejects an unmapped, invalid, or changing default profile", async () => {
    seedDocument(REGISTRY_PATH, { schemaVersion: 2 });

    await expect(setGoogleDefaultProfileId(UID, RT_PROFILE)).rejects.toThrow(
      "not connected"
    );
    await expect(setGoogleDefaultProfileId(UID, "bad profile!")).rejects.toThrow(
      "Invalid Google account profile id"
    );

    seedAccount(RT_PROFILE, "rt-account", TOKEN_RECORD, {
      pendingRevocation: true,
    });
    await expect(setGoogleDefaultProfileId(UID, RT_PROFILE)).rejects.toThrow(
      "needs to be reconnected"
    );
  });

  it("treats a pre-v2 root document as transitional legacy storage", async () => {
    seedDocument(REGISTRY_PATH, {
      accessToken: "legacy-access-token",
      refreshToken: "legacy-refresh-token",
    });

    await expect(resolveGoogleAccountTokens(UID)).resolves.toEqual({
      registryFound: false,
      profileMapped: false,
      record: null,
    });
  });

  it("persists refreshed credentials behind a transaction lock and stores no secret metadata", async () => {
    seedDocument(REGISTRY_PATH, { schemaVersion: 2 });
    seedAccount(RT_PROFILE, "rt-account", TOKEN_RECORD);

    await persistGoogleAccountTokens(UID, "rt-account", {
      ...TOKEN_RECORD,
      accessToken: "new-access-token",
      expiryDate: 9_888_888_888_888,
    });

    const stored = JSON.parse(
      firestore.secrets.get(`${UID}:google-oauth-account-rt-account`) || "{}"
    );
    expect(stored).toMatchObject({
      accessToken: "new-access-token",
      refreshToken: "refresh-token",
      scopePreset: "gmail_send",
    });
    expect(firestore.documents.get(accountPath("rt-account"))).toMatchObject({
      oauthHealthStatus: "healthy",
      lastRefreshStatus: "ok",
      scopePreset: "gmail_send",
      credentialWriteOperationId: null,
    });
    expect(firestore.documents.get(accountPath("rt-account"))).not.toHaveProperty(
      "accessToken"
    );
    expect(firestore.documents.get(accountPath("rt-account"))).not.toHaveProperty(
      "refreshToken"
    );
  });

  it("persists an identity-bound connection and scrubs plaintext legacy root fields", async () => {
    seedDocument(REGISTRY_PATH, {
      accessToken: "legacy-access-token",
      refreshToken: "legacy-refresh-token",
      expiryDate: 123,
      scope: "legacy-scope",
      tokenType: "Bearer",
    });

    const result = await persistGoogleAccountProfileTokens(UID, RT_PROFILE, {
      ...TOKEN_RECORD,
    }, "gmail_send");
    const expectedAccountId = accountIdForSubject(RT_SUBJECT);

    expect(result).toEqual({ accountId: expectedAccountId, profileId: RT_PROFILE });
    expect(firestore.documents.get(REGISTRY_PATH)).toMatchObject({ schemaVersion: 2 });
    for (const field of [
      "accessToken",
      "refreshToken",
      "expiryDate",
      "scope",
      "tokenType",
      "defaultAccountId",
    ]) {
      expect(firestore.documents.get(REGISTRY_PATH)).not.toHaveProperty(field);
    }
    expect(firestore.documents.get(bindingPath(RT_PROFILE))).toMatchObject({
      accountId: expectedAccountId,
      credentialWriteOperationId: null,
    });
    expect(
      firestore.secrets.get(`${UID}:google-oauth-account-${expectedAccountId}`)
    ).toContain("refresh-token");
  });

  it("preserves the same subject's refresh token on a reconnect", async () => {
    const first = await persistGoogleAccountProfileTokens(UID, RT_PROFILE, {
      ...TOKEN_RECORD,
    }, "gmail_send");

    const second = await persistGoogleAccountProfileTokens(UID, RT_PROFILE, {
      ...TOKEN_RECORD,
      accessToken: "reconnected-access-token",
      refreshToken: null,
      scope: "openid https://www.googleapis.com/auth/gmail.send email",
    }, "gmail_send");
    const stored = JSON.parse(
      firestore.secrets.get(`${UID}:google-oauth-account-${first.accountId}`) || "{}"
    );

    expect(second).toEqual(first);
    expect(stored).toMatchObject({
      accessToken: "reconnected-access-token",
      refreshToken: "refresh-token",
      accountSubject: RT_SUBJECT,
      scopePreset: "gmail_send",
    });
  });

  it("requires a new refresh token when a same-subject grant changes from full to core", async () => {
    const first = await persistGoogleAccountProfileTokens(
      UID,
      RT_PROFILE,
      {
        ...TOKEN_RECORD,
        scope: FULL_SCOPE,
        scopePreset: "full",
      },
      "full"
    );
    const secretKey = `${UID}:google-oauth-account-${first.accountId}`;
    const originalSecret = firestore.secrets.get(secretKey);
    firestore.setUserSecretMock.mockClear();

    await expect(
      persistGoogleAccountProfileTokens(
        UID,
        RT_PROFILE,
        {
          ...TOKEN_RECORD,
          refreshToken: null,
          scope: CORE_SCOPE,
          scopePreset: "core",
        },
        "core"
      )
    ).rejects.toThrow("Missing refresh token from Google");

    expect(firestore.setUserSecretMock).not.toHaveBeenCalled();
    expect(firestore.secrets.get(secretKey)).toBe(originalSecret);
    expect(firestore.documents.get(bindingPath(RT_PROFILE))).toMatchObject({
      accountId: first.accountId,
      credentialWriteOperationId: null,
    });
    expect(firestore.documents.get(accountPath(first.accountId))).toMatchObject({
      scopePreset: "full",
      credentialWriteOperationId: null,
    });
  });

  it("requires disconnect before replacing a profile's stable Google subject", async () => {
    const first = await persistGoogleAccountProfileTokens(
      UID,
      RT_PROFILE,
      { ...TOKEN_RECORD },
      "gmail_send"
    );
    const replacementSubject = "different-google-subject";
    const replacementAccountId = accountIdForSubject(replacementSubject);
    firestore.setUserSecretMock.mockClear();
    firestore.deleteUserSecretMock.mockClear();

    await expect(
      persistGoogleAccountProfileTokens(
        UID,
        RT_PROFILE,
        {
          ...TOKEN_RECORD,
          accountEmail: "replacement@example.com",
          accountSubject: replacementSubject,
          refreshToken: "replacement-refresh-token",
        },
        "gmail_send"
      )
    ).rejects.toBeInstanceOf(
      GoogleAccountProfileReplacementRequiresDisconnectError
    );

    expect(firestore.setUserSecretMock).not.toHaveBeenCalled();
    expect(firestore.deleteUserSecretMock).not.toHaveBeenCalled();
    expect(firestore.documents.get(bindingPath(RT_PROFILE))).toMatchObject({
      accountId: first.accountId,
    });
    expect(firestore.documents.has(accountPath(replacementAccountId))).toBe(false);
  });

  it("does not let one stable Google subject bind both canonical profiles", async () => {
    await persistGoogleAccountProfileTokens(
      UID,
      RT_PROFILE,
      { ...TOKEN_RECORD },
      "gmail_send"
    );
    firestore.setUserSecretMock.mockClear();

    await expect(
      persistGoogleAccountProfileTokens(UID, ROSSER_PROFILE, {
        ...TOKEN_RECORD,
        accountEmail: "same-subject@example.com",
      }, "gmail_send")
    ).rejects.toBeInstanceOf(GoogleAccountProfileConflictError);
    expect(firestore.setUserSecretMock).not.toHaveBeenCalled();
    expect(firestore.documents.has(bindingPath(ROSSER_PROFILE))).toBe(false);
  });

  it("blocks reconnect while disconnect is pending and blocks disconnect while reconnect owns the lock", async () => {
    seedDocument(REGISTRY_PATH, { schemaVersion: 2 });
    const rtAccountId = accountIdForSubject(RT_SUBJECT);
    seedAccount(RT_PROFILE, rtAccountId, TOKEN_RECORD);
    const pending = await beginGoogleAccountProfileDisconnect(UID, RT_PROFILE);

    await expect(
      persistGoogleAccountProfileTokens(UID, RT_PROFILE, {
        ...TOKEN_RECORD,
        refreshToken: "replacement-refresh-token",
      }, "gmail_send")
    ).rejects.toThrow("already changing");

    // Restore a healthy record, then pause the secret write after the reconnect
    // reservation commits so the competing disconnect observes the lock.
    seedDocument(accountPath(rtAccountId), {
      pendingRevocation: false,
      pendingRevocationOperationId: null,
      credentialWriteOperationId: null,
    });
    let releaseSecretWrite!: () => void;
    const secretWritePaused = new Promise<void>((resolve) => {
      releaseSecretWrite = resolve;
    });
    firestore.setUserSecretMock.mockImplementationOnce(async () => {
      await secretWritePaused;
    });
    const reconnect = persistGoogleAccountProfileTokens(UID, RT_PROFILE, {
      ...TOKEN_RECORD,
      refreshToken: "new-refresh-token",
    }, "gmail_send");
    await vi.waitFor(() => expect(firestore.setUserSecretMock).toHaveBeenCalled());
    await expect(beginGoogleAccountProfileDisconnect(UID, RT_PROFILE)).rejects.toThrow(
      "already changing"
    );
    releaseSecretWrite();
    await expect(reconnect).resolves.toMatchObject({ profileId: RT_PROFILE });
    expect(pending.operationId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("removes only a shared legacy binding without loading or revoking credentials", async () => {
    seedDocument(REGISTRY_PATH, {
      schemaVersion: 2,
      defaultProfileId: RT_PROFILE,
    });
    seedAccount(RT_PROFILE, "shared-account", TOKEN_RECORD);
    seedDocument(bindingPath(ROSSER_PROFILE), { accountId: "shared-account" });

    const prepared = await beginGoogleAccountProfileDisconnect(UID, RT_PROFILE);

    expect(prepared).toEqual({
      profileId: RT_PROFILE,
      accountId: "shared-account",
      operationId: null,
      localCredentialDeletionRequired: false,
    });
    expect(firestore.documents.has(bindingPath(RT_PROFILE))).toBe(false);
    expect(firestore.documents.has(bindingPath(ROSSER_PROFILE))).toBe(true);
    expect(firestore.documents.has(accountPath("shared-account"))).toBe(true);
    expect(firestore.documents.get(REGISTRY_PATH)).not.toHaveProperty(
      "defaultProfileId"
    );
    expect(firestore.accessUserSecretMock).not.toHaveBeenCalled();
    expect(firestore.deleteUserSecretMock).not.toHaveBeenCalled();
  });

  it("finishes only the exact pending disconnect operation id", async () => {
    seedDocument(REGISTRY_PATH, {
      schemaVersion: 2,
      defaultProfileId: RT_PROFILE,
    });
    seedAccount(RT_PROFILE, "rt-account", TOKEN_RECORD);
    const prepared = await beginGoogleAccountProfileDisconnect(UID, RT_PROFILE);
    const wrongOperationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    expect(prepared.localCredentialDeletionRequired).toBe(true);
    expect(firestore.accessUserSecretMock).not.toHaveBeenCalled();

    await expect(
      finishGoogleAccountProfileDisconnect(
        UID,
        RT_PROFILE,
        "rt-account",
        wrongOperationId
      )
    ).rejects.toThrow("operation changed");
    expect(firestore.deleteUserSecretMock).not.toHaveBeenCalled();

    await finishGoogleAccountProfileDisconnect(
      UID,
      RT_PROFILE,
      "rt-account",
      prepared.operationId || ""
    );
    expect(firestore.documents.has(bindingPath(RT_PROFILE))).toBe(false);
    expect(firestore.documents.has(accountPath("rt-account"))).toBe(false);
    expect(firestore.documents.get(REGISTRY_PATH)).not.toHaveProperty(
      "defaultProfileId"
    );
    expect(firestore.deleteUserSecretMock).toHaveBeenCalledWith(
      UID,
      "google-oauth-account-rt-account"
    );
  });

  it("disconnects locally without deleting the same Google subject bound by another Firebase user", async () => {
    const otherUid = "uid-2";
    const first = await persistGoogleAccountProfileTokens(
      UID,
      RT_PROFILE,
      { ...TOKEN_RECORD },
      "gmail_send"
    );
    const second = await persistGoogleAccountProfileTokens(
      otherUid,
      RT_PROFILE,
      {
        ...TOKEN_RECORD,
        accessToken: "other-user-access-token",
        refreshToken: "other-user-refresh-token",
      },
      "gmail_send"
    );
    const prepared = await beginGoogleAccountProfileDisconnect(UID, RT_PROFILE);

    await finishGoogleAccountProfileDisconnect(
      UID,
      RT_PROFILE,
      prepared.accountId || "",
      prepared.operationId || ""
    );

    expect(first.accountId).not.toBe(second.accountId);
    expect(firestore.documents.has(bindingPath(RT_PROFILE, UID))).toBe(false);
    expect(firestore.documents.has(accountPath(first.accountId, UID))).toBe(false);
    expect(firestore.secrets.has(`${UID}:google-oauth-account-${first.accountId}`)).toBe(false);
    expect(firestore.documents.get(bindingPath(RT_PROFILE, otherUid))).toMatchObject({
      accountId: second.accountId,
    });
    expect(firestore.documents.has(accountPath(second.accountId, otherUid))).toBe(true);
    expect(
      firestore.secrets.get(`${otherUid}:google-oauth-account-${second.accountId}`)
    ).toContain("other-user-refresh-token");
  });

  it("records sanitized refresh failures without touching the token secret", async () => {
    seedDocument(REGISTRY_PATH, { schemaVersion: 2 });
    seedAccount(RT_PROFILE, "rt-account", TOKEN_RECORD);

    await persistGoogleAccountTokenFailure(UID, "rt-account", {
      reauthRequired: true,
      code: "invalid grant! with details",
    });

    expect(firestore.setUserSecretMock).not.toHaveBeenCalled();
    expect(firestore.documents.get(accountPath("rt-account"))).toMatchObject({
      oauthHealthStatus: "reauth_required",
      lastRefreshStatus: "error",
      lastRefreshErrorCode: "invalid_grant__with_details",
      lastRefreshErrorMessage: "Google OAuth refresh requires reconnection.",
    });
  });
});
