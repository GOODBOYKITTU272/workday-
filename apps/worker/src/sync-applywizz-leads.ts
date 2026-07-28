import { fetchApplyWizzLeads } from "./applywizz-leads-client.js";
import { getApplyWizzLeadsEnv } from "./applywizz-leads-env.js";
import { createSupabaseApplyWizzCandidateStore, syncApplyWizzLeads } from "./applywizz-leads-sync.js";
import { createWorkerSupabaseClient } from "./worker-env.js";

async function main() {
  const leadsEnv = getApplyWizzLeadsEnv();
  const client = createWorkerSupabaseClient();
  const summary = await syncApplyWizzLeads({
    fetchLeads: () => fetchApplyWizzLeads(leadsEnv),
    store: createSupabaseApplyWizzCandidateStore(client)
  });

  console.log(JSON.stringify(summary));
}

main().catch(() => {
  console.error("ApplyWizz leads sync failed.");
  process.exit(1);
});
