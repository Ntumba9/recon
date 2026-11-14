import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { POST as postRuns } from "@/app/api/runs/route";
import { POST as postFindingStatus } from "@/app/api/findings/[id]/status/route";
import { createTestFinding } from "../helpers/dbFixtures";

const prisma = new PrismaClient();

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function postStatusFor(id: string, body: unknown) {
  const request = jsonRequest(`http://localhost/api/findings/${id}/status`, body);
  return postFindingStatus(request, { params: Promise.resolve({ id }) });
}

describe("API contract: shared error shape and status codes", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("every error response", () => {
    it("has the shape { error, message, requestId }", async () => {
      const res = await postStatusFor("not-a-real-id", { status: "ACKNOWLEDGED" });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toMatchObject({ error: expect.any(String), message: expect.any(String), requestId: expect.any(String) });
    });
  });

  describe("POST /api/findings/:id/status", () => {
    it("400s with invalid_body on malformed input", async () => {
      const finding = await createTestFinding(prisma);
      const res = await postStatusFor(finding.id, { status: "CLOSED" });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_body");
    });

    it("400s with invalid_json on unparseable JSON", async () => {
      const finding = await createTestFinding(prisma);
      const request = jsonRequest(`http://localhost/api/findings/${finding.id}/status`, "{not json");
      const res = await postFindingStatus(request, { params: Promise.resolve({ id: finding.id }) });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_json");
    });

    it("404s with not_found on an unknown finding id", async () => {
      const res = await postStatusFor("not-a-real-id", { status: "ACKNOWLEDGED" });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("not_found");
    });

    it("409s with invalid_transition on an unreachable status change", async () => {
      // RESOLVED can only go to OPEN per the UI's own buttons; ACKNOWLEDGED
      // is not reachable from RESOLVED in one hop.
      const finding = await createTestFinding(prisma, { status: "RESOLVED" });
      const res = await postStatusFor(finding.id, { status: "ACKNOWLEDGED" });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe("invalid_transition");
    });

    it("allows a note-only edit that leaves status unchanged", async () => {
      const finding = await createTestFinding(prisma, { status: "ACKNOWLEDGED", note: "old" });
      const res = await postStatusFor(finding.id, { status: "ACKNOWLEDGED", note: "updated" });
      expect(res.status).toBe(200);
      const updated = await prisma.findingRecord.findUniqueOrThrow({ where: { id: finding.id } });
      expect(updated.note).toBe("updated");
      expect(updated.status).toBe("ACKNOWLEDGED");
    });
  });

  describe("POST /api/runs", () => {
    it("400s with invalid_body when windowStart is given without windowEnd", async () => {
      const res = await postRuns(jsonRequest("http://localhost/api/runs", { windowStart: new Date().toISOString() }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_body");
    });

    it("400s with invalid_json on unparseable JSON", async () => {
      const res = await postRuns(jsonRequest("http://localhost/api/runs", "{not json"));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_json");
    });
  });
});
