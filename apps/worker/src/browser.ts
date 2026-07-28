import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type LaunchOptions, type Page } from "playwright";

export const SMOKE_TEST_URL = "data:text/html,<title>ApplyWizz Worker Smoke Test</title>";

type BrowserLauncher = {
  launch: (options: LaunchOptions) => Promise<Pick<Browser, "close" | "newContext">>;
};

type BrowserLike = Pick<Browser, "close" | "newContext">;
type BrowserContextLike = Pick<BrowserContext, "close" | "newPage">;
type PageLike = Pick<Page, "close" | "goto" | "title">;

export function getBrowserLaunchOptions(): LaunchOptions {
  return {
    headless: true,
    timeout: 30_000
  };
}

export function getBrowserContextOptions(): BrowserContextOptions {
  return {
    viewport: {
      height: 720,
      width: 1280
    }
  };
}

export async function createBrowserContext(launcher: BrowserLauncher = chromium) {
  const browser = await launcher.launch(getBrowserLaunchOptions());

  try {
    const context = await browser.newContext(getBrowserContextOptions());

    return { browser, context };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

export async function runBrowserSmokeTest(launcher: BrowserLauncher = chromium) {
  let browser: BrowserLike | null = null;
  let context: BrowserContextLike | null = null;
  let page: PageLike | null = null;

  try {
    const created = await createBrowserContext(launcher);
    browser = created.browser;
    context = created.context;
    page = await context.newPage();

    await page.goto(SMOKE_TEST_URL);

    return {
      ok: true,
      title: await page.title(),
      url: SMOKE_TEST_URL
    };
  } finally {
    await page?.close();
    await context?.close();
    await browser?.close();
  }
}
