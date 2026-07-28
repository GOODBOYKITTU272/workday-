import { describe, expect, it, vi } from "vitest";

import { fetchApplyWizzLeads } from "../src/applywizz-leads-client";

describe("ApplyWizz leads client", () => {
  it("fetches leads with Basic auth without returning credentials", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ count: 1, results: [leadResponse()] }), { status: 200 }));

    const leads = await fetchApplyWizzLeads(
      {
        apiUrl: "https://dashboard.example.test/api/v1/leads/",
        basicAuth: "base64-test"
      },
      fetchMock
    );

    expect(leads).toEqual([leadResponse()]);
    expect(fetchMock).toHaveBeenCalledWith("https://dashboard.example.test/api/v1/leads/", {
      headers: {
        Authorization: "Basic base64-test"
      },
      method: "GET"
    });
    expect(JSON.stringify(leads)).not.toContain("base64-test");
  });

  it("throws a fixed safe error on fetch failure", async () => {
    await expect(
      fetchApplyWizzLeads(
        {
          apiUrl: "https://dashboard.example.test/api/v1/leads/",
          basicAuth: "base64-test"
        },
        async () => new Response("credential leak base64-test", { status: 500 })
      )
    ).rejects.toThrow("APPLYWIZZ_LEADS_FETCH_FAILED");
  });
});

function leadResponse() {
  return {
    assigned_associate: {
      email: "associate@example.com",
      id: 2026,
      name: "Associate"
    },
    clientPreferences: {},
    created_at: "2026-07-08T05:59:29.435251Z",
    email: "candidate@example.com",
    endDate: null,
    id: 1745,
    location: "Connecticut",
    name: "Candidate",
    number_of_applications: "20+",
    plan: "Standard",
    startDate: "2026-07-08",
    status: "In Progress",
    targetRoleName: "AI/ML Engineer",
    yearsExp: 0
  };
}
