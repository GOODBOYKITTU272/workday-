import { runWorkdayPageOpenCheck } from "./workday-page-snapshot.js";

const shouldRun = process.env.RUN_WORKDAY_PAGE_OPEN_SMOKE_TEST === "1";
const jobUrl = process.env.TEST_WORKDAY_JOB_URL?.trim();

if (!shouldRun || !jobUrl) {
  console.log(
    JSON.stringify({
      ok: true,
      reason: "Set RUN_WORKDAY_PAGE_OPEN_SMOKE_TEST=1 and TEST_WORKDAY_JOB_URL to run the optional Workday page smoke test.",
      skipped: true
    })
  );
  process.exit(0);
}

const result = await runWorkdayPageOpenCheck(jobUrl);

console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
