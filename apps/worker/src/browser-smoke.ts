import { runBrowserSmokeTest } from "./browser.js";

const result = await runBrowserSmokeTest();

console.log(JSON.stringify(result));
