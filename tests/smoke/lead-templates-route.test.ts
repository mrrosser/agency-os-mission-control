import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/leads/templates/route";
import { DELETE } from "@/app/api/leads/templates/[templateId]/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAdminDb } from "@/lib/firebase-admin";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const getAdminDbMock = vi.mocked(getAdminDb);

function createContext(params: Record<string, string> = {}) {
  return { params: Promise.resolve(params) };
}

describe("lead templates routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as { uid: string });
  });

  it("lists templates", async () => {
    const getMock = vi.fn(async () => ({
      docs: [
        {
          id: "t1",
          data: () => ({
            name: "Austin HVAC",
            clientName: "Acme",
            params: { query: "HVAC contractors", limit: 10, minScore: 55 },
            outreach: { useSMS: true, draftFirst: true },
          }),
        },
      ],
    }));

    const limitMock = vi.fn(() => ({ get: getMock }));
    const orderByMock = vi.fn(() => ({ limit: limitMock }));

    const templatesCollection = {
      orderBy: orderByMock,
    };

    const identityDoc = {
      collection: vi.fn(() => templatesCollection),
    };

    const identitiesCollection = {
      doc: vi.fn(() => identityDoc),
    };

    getAdminDbMock.mockReturnValue({
      collection: vi.fn(() => identitiesCollection),
    } as unknown as ReturnType<typeof getAdminDb>);

    const req = new Request("http://localhost/api/leads/templates", { method: "GET" });
    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );

    const data = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(data.templates)).toBe(true);
    expect(data.templates).toHaveLength(1);
    expect(data.templates[0].templateId).toBe("t1");
    expect(data.templates[0].name).toBe("Austin HVAC");
  });

  it("upserts a template", async () => {
    const docRef = { id: "t-upsert" };

    const templatesCollection = {
      doc: vi.fn(() => docRef),
    };

    const identityDoc = {
      collection: vi.fn(() => templatesCollection),
    };

    const identitiesCollection = {
      doc: vi.fn(() => identityDoc),
    };

    const txGet = vi.fn(async () => ({ exists: false }));
    const txSet = vi.fn();

    const runTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({ get: txGet, set: txSet });
    });

    getAdminDbMock.mockReturnValue({
      collection: vi.fn(() => identitiesCollection),
      runTransaction,
    } as unknown as ReturnType<typeof getAdminDb>);

    const body = {
      templateId: "t-upsert",
      name: "Template 1",
      clientName: "Client A",
      params: { query: "plumbers", location: "Austin, TX", limit: 5, minScore: 60 },
      outreach: { useSMS: true, useAvatar: false, useOutboundCall: true, draftFirst: true },
    };

    const req = new Request("http://localhost/api/leads/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.template.templateId).toBe("t-upsert");
    expect(txSet).toHaveBeenCalledOnce();
    expect((templatesCollection.doc as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]).toBe("t-upsert");
  });

  it("upserts a template with a long query description", async () => {
    const docRef = { id: "t-long" };

    const templatesCollection = {
      doc: vi.fn(() => docRef),
    };

    const identityDoc = {
      collection: vi.fn(() => templatesCollection),
    };

    const identitiesCollection = {
      doc: vi.fn(() => identityDoc),
    };

    const txGet = vi.fn(async () => ({ exists: false }));
    const txSet = vi.fn();

    const runTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({ get: txGet, set: txSet });
    });

    getAdminDbMock.mockReturnValue({
      collection: vi.fn(() => identitiesCollection),
      runTransaction,
    } as unknown as ReturnType<typeof getAdminDb>);

    const longQuery =
      "We are looking for art buyers in New Orleans that want to book private gallery events and commission local artists. ";

    const body = {
      templateId: "t-long",
      name: "Long Query Template",
      clientName: "Client A",
      params: { query: longQuery.repeat(3).trim(), location: "New Orleans, LA", limit: 5, minScore: 60 },
      outreach: { useSMS: true, useAvatar: false, useOutboundCall: true, draftFirst: true },
    };

    const req = new Request("http://localhost/api/leads/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.template.templateId).toBe("t-long");
    expect(txSet).toHaveBeenCalledOnce();
  });

  it("coerces and clamps loose template payloads instead of rejecting", async () => {
    const docRef = { id: "t-coerce" };

    const templatesCollection = {
      doc: vi.fn(() => docRef),
    };

    const identityDoc = {
      collection: vi.fn(() => templatesCollection),
    };

    const identitiesCollection = {
      doc: vi.fn(() => identityDoc),
    };

    const txGet = vi.fn(async () => ({ exists: false }));
    const txSet = vi.fn();

    const runTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({ get: txGet, set: txSet });
    });

    getAdminDbMock.mockReturnValue({
      collection: vi.fn(() => identitiesCollection),
      runTransaction,
    } as unknown as ReturnType<typeof getAdminDb>);

    const body = {
      templateId: " t-coerce ",
      name: "  Multi Channel New Orleans Search  ",
      clientName: "  ACME Client  ",
      params: {
        query: "q".repeat(620),
        industry: "Art Buyers ".repeat(20),
        location: "New Orleans, Louisiana, United States".repeat(8),
        limit: "99",
        minScore: "-5",
        includeEnrichment: "true",
        sources: ["googlePlaces", "badSource", "firestore"],
      },
      outreach: {
        businessKey: "RNG",
        useSMS: "1",
        useAvatar: "0",
        useOutboundCall: "true",
        draftFirst: "false",
      },
    };

    const req = new Request("http://localhost/api/leads/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.template.templateId).toBe("t-coerce");
    expect(data.template.name).toBe("Multi Channel New Orleans Search");
    expect(data.template.clientName).toBe("ACME Client");
    expect(data.template.params.limit).toBe(25);
    expect(data.template.params.minScore).toBe(0);
    expect(data.template.params.query.length).toBe(500);
    expect(data.template.params.industry.length).toBe(80);
    expect(data.template.params.location.length).toBe(120);
    expect(data.template.params.includeEnrichment).toBe(true);
    expect(data.template.params.sources).toEqual(["googlePlaces", "firestore"]);
    expect(data.template.outreach.businessKey).toBe("rng");
    expect(data.template.outreach.useSMS).toBe(true);
    expect(data.template.outreach.useAvatar).toBe(false);
    expect(data.template.outreach.useOutboundCall).toBe(true);
    expect(data.template.outreach.draftFirst).toBe(false);
    expect(txSet).toHaveBeenCalledOnce();
  });

  it("deletes a template", async () => {
    const deleteMock = vi.fn(async () => undefined);
    const templateDoc = { delete: deleteMock };

    const templatesCollection = {
      doc: vi.fn(() => templateDoc),
    };

    const identityDoc = {
      collection: vi.fn(() => templatesCollection),
    };

    const identitiesCollection = {
      doc: vi.fn(() => identityDoc),
    };

    getAdminDbMock.mockReturnValue({
      collection: vi.fn(() => identitiesCollection),
    } as unknown as ReturnType<typeof getAdminDb>);

    const req = new Request("http://localhost/api/leads/templates/t1", { method: "DELETE" });
    const res = await DELETE(
      req as unknown as Parameters<typeof DELETE>[0],
      createContext({ templateId: "t1" }) as unknown as Parameters<typeof DELETE>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(deleteMock).toHaveBeenCalledOnce();
  });
});
