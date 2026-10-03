import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectFirestoreEmulator,
  disableNetwork,
  doc,
  getDocFromCache,
  getFirestore,
  onSnapshot,
  runTransaction,
  setDoc,
  terminate,
  type Firestore,
} from "firebase/firestore";
import type * as Grpc from "@grpc/grpc-js";

// Resolve from the package being repaired, not a potentially different grpc-js
// copy used by google-gax/Admin SDK. No Firebase Admin or application auth loads.
const requireHere = createRequire(import.meta.url);
const requireFirestore = createRequire(requireHere.resolve("@firebase/firestore/package.json"));
const grpc: typeof Grpc = requireFirestore("@grpc/grpc-js");
const protoLoader: typeof import("@grpc/proto-loader") = requireFirestore("@grpc/proto-loader");
const descriptor = requireHere("@google-cloud/firestore/build/protos/v1.json");
const definition = protoLoader.fromJSON(descriptor, {
  longs: String,
  enums: String,
  defaults: true,
  oneofs: false,
});
const loaded = grpc.loadPackageDefinition(definition) as unknown as {
  google: { firestore: { v1: { Firestore: Grpc.ServiceClientConstructor } } };
};
const FirestoreService = loaded.google.firestore.v1.Firestore;

const PROJECT = "demo-grpc-compatibility";
const DATABASE = `projects/${PROJECT}/databases/(default)`;
const DOCUMENT = `${DATABASE}/documents/fixtures/one`;
const MISSING = `${DATABASE}/documents/fixtures/missing`;
const timestamp = { seconds: "1700000000", nanos: 123000000 };
type Value = { integerValue?: string; stringValue?: string; booleanValue?: boolean };
type Document = { name: string; fields: Record<string, Value>; updateTime: typeof timestamp };
type Write = {
  update?: Document;
  currentDocument?: { updateTime?: typeof timestamp; exists?: boolean };
};
type Request = {
  database?: string;
  documents?: string[];
  writes?: Write[];
  streamToken?: Buffer;
  addTarget?: { targetId: number; documents: { documents: string[] } };
  removeTarget?: number;
};
type Response = Record<string, unknown>;
type Observation = { method: string; request: Request; metadata: Grpc.Metadata };

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Local gRPC fixture timed out: ${label}`)), 5000);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

describe("Firebase Node Firestore compatibility with the patched gRPC transport", () => {
  let server: Grpc.Server;
  let app: FirebaseApp;
  let db: Firestore;
  let address: string;
  let observations: Observation[];
  let records: Map<string, Document>;
  let readFailure: number | null;
  let commitFailure: number | null;
  let writeFailure: number | null;
  let holdRead: boolean;
  let readStarted: ReturnType<typeof deferred<void>>;
  let readCancelled: ReturnType<typeof deferred<void>>;
  let writeEnded: ReturnType<typeof deferred<void>>;
  let listenEnded: ReturnType<typeof deferred<void>>;
  let sdkTerminated: boolean;
  const rawClients: Grpc.Client[] = [];

  beforeEach(async () => {
    observations = [];
    records = new Map([[DOCUMENT, {
      name: DOCUMENT,
      fields: { count: { integerValue: "7" }, label: { stringValue: "synthetic fixture" } },
      updateTime: timestamp,
    }]]);
    readFailure = commitFailure = writeFailure = null;
    holdRead = sdkTerminated = false;
    readStarted = deferred();
    readCancelled = deferred();
    writeEnded = deferred();
    listenEnded = deferred();
    server = new grpc.Server();
    const remember = (method: string, request: Request, metadata: Grpc.Metadata) => {
      observations.push({ method, request, metadata });
    };
    const save = (writes: Write[]) => {
      for (const write of writes) {
        if (write.update) records.set(write.update.name, { ...write.update, updateTime: timestamp });
      }
    };
    const failure = (code: number) => Object.assign(new Error("synthetic fixture rejection"), {
      code,
      details: "synthetic fixture rejection",
    });

    server.addService(FirestoreService.service, {
      BatchGetDocuments(call: Grpc.ServerWritableStream<Request, Response>) {
        remember("BatchGetDocuments", call.request, call.metadata);
        call.on("cancelled", () => readCancelled.resolve());
        readStarted.resolve();
        if (holdRead) return;
        if (readFailure !== null) { call.emit("error", failure(readFailure)); return; }
        for (const name of call.request.documents || []) {
          const found = records.get(name);
          call.write(found ? { found, readTime: timestamp } : { missing: name, readTime: timestamp });
        }
        call.end();
      },
      Commit(call: Grpc.ServerUnaryCall<Request, Response>, callback: Grpc.sendUnaryData<Response>) {
        remember("Commit", call.request, call.metadata);
        if (commitFailure !== null) { callback(failure(commitFailure)); return; }
        const writes = call.request.writes || [];
        save(writes);
        callback(null, { commitTime: timestamp, writeResults: writes.map(() => ({ updateTime: timestamp })) });
      },
      Write(call: Grpc.ServerDuplexStream<Request, Response>) {
        let handshaken = false;
        call.on("data", (request: Request) => {
          remember("Write", request, call.metadata);
          if (!handshaken) {
            handshaken = true;
            call.write({ streamId: "synthetic-write", streamToken: Buffer.from("handshake") });
            return;
          }
          if (writeFailure !== null) { call.emit("error", failure(writeFailure)); return; }
          const writes = request.writes || [];
          save(writes);
          call.write({
            streamId: "synthetic-write",
            streamToken: Buffer.from("acknowledged"),
            commitTime: timestamp,
            writeResults: writes.map(() => ({ updateTime: timestamp })),
          });
        });
        call.on("end", () => { writeEnded.resolve(); call.end(); });
      },
      Listen(call: Grpc.ServerDuplexStream<Request, Response>) {
        call.on("data", (request: Request) => {
          remember("Listen", request, call.metadata);
          if (request.addTarget) {
            const targetId = request.addTarget.targetId;
            call.write({ targetChange: { targetChangeType: "ADD", targetIds: [targetId] } });
            call.write({ documentChange: { document: records.get(DOCUMENT), targetIds: [targetId] } });
            call.write({ targetChange: { targetChangeType: "CURRENT", targetIds: [targetId] } });
            call.write({ targetChange: { targetChangeType: "NO_CHANGE", readTime: timestamp } });
          } else if (request.removeTarget) {
            call.write({ targetChange: { targetChangeType: "REMOVE", targetIds: [request.removeTarget] } });
          }
        });
        call.on("end", () => { listenEnded.resolve(); call.end(); });
      },
    });
    const port = await bounded(new Promise<number>((resolve, reject) => {
      server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (error, boundPort) => {
        if (error) reject(error); else resolve(boundPort);
      });
    }), "bind loopback");
    address = `127.0.0.1:${port}`;
    app = initializeApp({ projectId: PROJECT, apiKey: "synthetic-local-only" }, `grpc-fixture-${port}`);
    db = getFirestore(app);
    // This replaces the Firebase credential provider with an emulator-only token.
    // No ambient ADC, environment credential, OAuth, or external host is used.
    connectFirestoreEmulator(db, "127.0.0.1", port, { mockUserToken: "owner" });
  });

  afterEach(async () => {
    try {
      try {
        if (db && !sdkTerminated) await bounded(terminate(db), "SDK shutdown");
      } finally {
        if (app) await bounded(deleteApp(app), "Firebase app shutdown");
      }
    } finally {
      for (const client of rawClients.splice(0)) client.close();
      if (server) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => { server.forceShutdown(); resolve(); }, 1000);
          server.tryShutdown(() => { clearTimeout(timer); resolve(); });
        });
      }
      vi.restoreAllMocks();
    }
  });

  it("decodes streamed found/missing documents and commits a real SDK transaction with metadata", async () => {
    expect(requireFirestore("@grpc/grpc-js/package.json").version).toBe("1.14.5");
    const result = await runTransaction(db, async (transaction) => {
      const existing = await transaction.get(doc(db, "fixtures/one"));
      const missing = await transaction.get(doc(db, "fixtures/missing"));
      expect(existing.data()).toEqual({ count: 7, label: "synthetic fixture" });
      expect(missing.exists()).toBe(false);
      transaction.update(existing.ref, { count: existing.data()!.count + 1 });
      transaction.set(missing.ref, { label: "created only in fixture" });
      return existing.data()!.count;
    }, { maxAttempts: 1 });
    expect(result).toBe(7);
    expect(observations.map((entry) => entry.method)).toEqual(["BatchGetDocuments", "BatchGetDocuments", "Commit"]);
    const commit = observations[2];
    expect(commit.request.database).toBe(DATABASE);
    expect(commit.request.writes).toEqual(expect.arrayContaining([
      expect.objectContaining({ update: expect.objectContaining({ name: DOCUMENT, fields: { count: { integerValue: "8" } } }), currentDocument: { updateTime: timestamp } }),
      expect.objectContaining({ update: expect.objectContaining({ name: MISSING, fields: { label: { stringValue: "created only in fixture" } } }), currentDocument: { exists: false } }),
    ]));
    for (const observation of observations) {
      expect(observation.metadata.get("authorization")).toEqual(["Bearer owner"]);
      expect(observation.metadata.get("google-cloud-resource-prefix")).toEqual([DATABASE]);
      expect(observation.metadata.get("x-goog-api-client")[0]).toEqual(expect.stringContaining("gl-node/"));
    }
  });

  it("maps a server-readable error to a Firebase error without committing", async () => {
    readFailure = grpc.status.PERMISSION_DENIED;
    await expect(runTransaction(db, (transaction) => transaction.get(doc(db, "fixtures/one")), { maxAttempts: 1 }))
      .rejects.toMatchObject({ code: "permission-denied", message: expect.stringContaining("synthetic fixture rejection") });
    expect(observations.map((entry) => entry.method)).toEqual(["BatchGetDocuments"]);
  });

  it.each([
    ["permission-denied", 7],
    ["unavailable", 14],
  ])("propagates unary %s and obeys the SDK's one-attempt transaction bound", async (code, status) => {
    commitFailure = status as number;
    await expect(runTransaction(db, async (transaction) => {
      transaction.set(doc(db, "fixtures/missing"), { count: 42 });
    }, { maxAttempts: 1 })).rejects.toMatchObject({ code });
    expect(observations.map((entry) => entry.method)).toEqual(["Commit"]);
    expect(records.has(MISSING)).toBe(false);
  });

  it("acknowledges a duplex SDK write, ends its stream, and closes the actual client stub", async () => {
    const close = vi.spyOn(grpc.Client.prototype, "close");
    const reference = doc(db, "fixtures/missing");
    await setDoc(reference, { count: 42, label: "duplex synthetic write" });
    expect((await getDocFromCache(reference)).data()).toEqual({ count: 42, label: "duplex synthetic write" });
    const writes = observations.filter((entry) => entry.method === "Write");
    expect(writes).toHaveLength(2);
    expect(writes[0].request.database).toBe(DATABASE);
    expect(writes[0].request.writes).toEqual([]);
    expect(writes[1].request.streamToken).toEqual(Buffer.from("handshake"));
    expect(writes[1].request.writes?.[0].update?.name).toBe(MISSING);
    await disableNetwork(db);
    await bounded(writeEnded.promise, "write half-close");
    await terminate(db);
    sdkTerminated = true;
    expect(close).toHaveBeenCalledOnce();
    // The SDK may flush an empty token frame during half-close; it must not
    // repeat the application write or permit another operation after shutdown.
    expect(observations.filter((entry) => entry.method === "Write" && entry.request.writes?.length)).toHaveLength(1);
    const requestsAfterShutdown = observations.length;
    expect(() => getDocFromCache(reference)).toThrow("The client has already been terminated.");
    expect(observations).toHaveLength(requestsAfterShutdown);
  });

  it("rejects a duplex write on a permanent gRPC error instead of acknowledging it", async () => {
    writeFailure = grpc.status.PERMISSION_DENIED;
    await expect(setDoc(doc(db, "fixtures/missing"), { count: 42 }))
      .rejects.toMatchObject({ code: "permission-denied" });
    expect(records.has(MISSING)).toBe(false);
    expect(observations.filter((entry) => entry.method === "Write" && entry.request.writes?.length)).toHaveLength(1);
  });

  it("delivers a real SDK watch snapshot and ends the duplex Listen stream on disableNetwork", async () => {
    const received = deferred<Record<string, unknown>>();
    const error = vi.fn();
    const unsubscribe = onSnapshot(doc(db, "fixtures/one"), (snapshot) => {
      if (!snapshot.metadata.fromCache) received.resolve(snapshot.data() || {});
    }, error);
    try {
      expect(await bounded(received.promise, "listen snapshot")).toEqual({ count: 7, label: "synthetic fixture" });
      expect(observations.find((entry) => entry.request.addTarget)?.request.addTarget?.documents.documents)
        .toEqual([DOCUMENT]);
      await disableNetwork(db);
      await bounded(listenEnded.promise, "listen half-close");
      expect(error).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });

  it("cancels the generated readable RPC and closes its channel without a server response", async () => {
    holdRead = true;
    const client = new FirestoreService(address, grpc.credentials.createInsecure()) as unknown as Grpc.Client & {
      BatchGetDocuments(request: Request, metadata: Grpc.Metadata): Grpc.ClientReadableStream<Response>;
    };
    rawClients.push(client);
    const metadata = new grpc.Metadata();
    metadata.set("x-fixture", "cancel-only");
    const stream = client.BatchGetDocuments({ database: DATABASE, documents: [DOCUMENT] }, metadata);
    const failed = deferred<Grpc.ServiceError>();
    const data = vi.fn();
    stream.on("data", data);
    stream.on("error", (error: Grpc.ServiceError) => failed.resolve(error));
    await bounded(readStarted.promise, "cancel request reaches server");
    stream.cancel();
    expect((await bounded(failed.promise, "client cancellation")).code).toBe(grpc.status.CANCELLED);
    await bounded(readCancelled.promise, "server cancellation");
    expect(data).not.toHaveBeenCalled();
    expect(observations[0].metadata.get("x-fixture")).toEqual(["cancel-only"]);
    client.close();
    rawClients.splice(rawClients.indexOf(client), 1);
    expect(client.getChannel().getConnectivityState(false)).toBe(grpc.connectivityState.SHUTDOWN);
  });
});
