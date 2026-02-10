import { describe, it, expect } from "vitest";
import { FieldValue } from "firebase-admin/firestore";
import { stripUndefined } from "@/lib/firestore/strip-undefined";

describe("stripUndefined", () => {
  it("removes undefined fields but preserves Firestore FieldValue transforms", () => {
    const ts = FieldValue.serverTimestamp();
    const input = {
      email: undefined as string | undefined,
      nested: {
        a: 1,
        b: undefined as number | undefined,
      },
      arr: [1, undefined, 2],
      createdAt: ts,
    };

    const out = stripUndefined(input) as Record<string, unknown>;
    expect(out).not.toHaveProperty("email");
    expect(out).toHaveProperty("nested");
    expect((out.nested as Record<string, unknown>)).toEqual({ a: 1 });
    expect(out.arr).toEqual([1, 2]);
    expect(out.createdAt).toBe(ts);
  });
});

