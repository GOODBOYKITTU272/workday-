import { APP_NAME } from "@applywizz/shared";

export function getWorkerBanner() {
  return `${APP_NAME} worker scaffold`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(getWorkerBanner());
}
