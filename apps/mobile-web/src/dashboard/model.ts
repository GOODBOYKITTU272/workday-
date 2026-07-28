export type DashboardCounts = {
  candidates: number;
  jobLinks: number;
  manualReviewOpen: number;
  runs: number;
};

export function buildDashboardCards(counts: DashboardCounts) {
  return [
    { label: "Candidates", value: String(counts.candidates) },
    { label: "Job Links", value: String(counts.jobLinks) },
    { label: "Runs", value: String(counts.runs) },
    { label: "Open Manual Review", value: String(counts.manualReviewOpen) }
  ];
}
