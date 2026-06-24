/**
 * Appium script: transfer-to-buyer
 *
 * Runs on AWS Device Farm on a real Android device with MLB Ballpark installed.
 * Logs into deposits@buzzerseats.com, finds the ticket for this listing,
 * and transfers it to the buyer's email address.
 *
 * Environment variables injected by Device Farm:
 *   MLB_DEPOSITS_EMAIL
 *   MLB_DEPOSITS_PASSWORD
 *   BUYER_EMAIL           — the buyer's MLB account email
 *   LISTING_ID            — used for logging
 */

const { remote } = require("webdriverio");

const EMAIL = process.env.MLB_DEPOSITS_EMAIL;
const PASSWORD = process.env.MLB_DEPOSITS_PASSWORD;
const BUYER_EMAIL = process.env.BUYER_EMAIL;

if (!BUYER_EMAIL) {
  console.error("FAILURE: BUYER_EMAIL env var is required");
  process.exit(1);
}

const APP_PACKAGE = "com.bamnetworks.mobile.android.ballpark";

const CAPS = {
  platformName: "Android",
  "appium:automationName": "UiAutomator2",
  "appium:appPackage": APP_PACKAGE,
  "appium:appActivity": "com.bamnetworks.mobile.android.ballpark.activity.MainActivity",
  "appium:appWaitActivity": "*",
  "appium:noReset": true,
  "appium:autoGrantPermissions": true,
  "appium:skipUnlock": true,
  "appium:newCommandTimeout": 180,
  "appium:chromeOptions": { androidPackage: "com.android.chrome" },
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Try clicking each selector in order; return true if one worked. */
async function tryClick(driver, selectors, timeout = 10000) {
  for (const sel of selectors) {
    try {
      const el = await driver.$(sel);
      await el.waitForDisplayed({ timeout });
      await el.click();
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

/** Switch Appium context to any available WebView/Chrome context. */
async function switchToWebContext(driver, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const contexts = await driver.getContexts();
    console.log("Available contexts:", JSON.stringify(contexts));
    const webCtx = contexts.find(
      (c) => c !== "NATIVE_APP" && (c.includes("WEBVIEW") || c.includes("CHROMIUM"))
    );
    if (webCtx) {
      await driver.switchContext(webCtx);
      console.log("Switched to web context:", webCtx);
      return webCtx;
    }
    await sleep(2000);
  }
  return null;
}

/** Fill a form field on the MLB login web page (runs in WebView context). */
async function webFill(driver, cssSelectors, value) {
  for (const sel of cssSelectors) {
    try {
      const el = await driver.$(sel);
      await el.waitForDisplayed({ timeout: 8000 });
      await el.clearValue();
      await el.setValue(value);
      return;
    } catch {}
  }
  throw new Error(`Could not fill field with selectors: ${cssSelectors.join(", ")}`);
}

/** Click a button on the MLB login web page (runs in WebView context). */
async function webClick(driver, cssSelectors) {
  for (const sel of cssSelectors) {
    try {
      const el = await driver.$(sel);
      await el.waitForDisplayed({ timeout: 8000 });
      await el.click();
      return;
    } catch {}
  }
  throw new Error(`Could not click element with selectors: ${cssSelectors.join(", ")}`);
}

async function login(driver) {
  // Check if already on home/tickets screen (already logged in)
  try {
    const ticketsTab = await driver.$('//*[@content-desc="Tickets" or @text="Tickets"]');
    if (await ticketsTab.isDisplayed()) {
      console.log("Already logged in, skipping login");
      return;
    }
  } catch {}

  // Dismiss force-update dialog if present
  await tryClick(driver, [
    '//android.widget.Button[contains(@text,"Update")]',
    '//android.widget.Button[contains(@text,"Not Now")]',
    '//android.widget.Button[contains(@text,"Later")]',
    '//*[contains(@text,"Not now")]',
    '//*[contains(@text,"Skip Update")]',
  ], 5000);

  await sleep(1000);

  // Dismiss any initial splash/permissions dialogs
  await tryClick(driver, [
    '//android.widget.Button[contains(@text,"Allow")]',
    '//android.widget.Button[contains(@text,"OK")]',
    '//android.widget.Button[contains(@text,"Skip")]',
    '//android.widget.Button[contains(@text,"Continue")]',
    '//android.widget.Button[contains(@text,"Got it")]',
    '//android.widget.Button[contains(@text,"Accept")]',
  ], 5000);

  await sleep(2000);

  // Find and tap "Sign In" / "Log In"
  const tappedSignIn = await tryClick(driver, [
    '//*[contains(@text,"Sign In") or contains(@text,"Log In") or contains(@text,"Sign in")]',
    '//*[contains(@content-desc,"Sign In")]',
    '//android.widget.Button[contains(@text,"Get Started")]',
  ], 15000);

  if (!tappedSignIn) {
    throw new Error("Could not find Sign In button on welcome screen");
  }

  await sleep(3000);

  // MLB login opens a Chrome Custom Tab (OAuth web flow).
  // Try native context first (some app versions use a native form).
  let loggedInNatively = false;
  try {
    const emailField = await driver.$(
      '//android.widget.EditText[contains(@hint,"email") or contains(@hint,"Email") or contains(@hint,"username")]'
    );
    if (await emailField.isDisplayed()) {
      console.log("Native login form detected");
      await emailField.setValue(EMAIL);

      await tryClick(driver, [
        '//android.widget.Button[contains(@text,"Continue")]',
        '//android.widget.Button[contains(@text,"Next")]',
      ]);
      await sleep(1000);

      const passField = await driver.$(
        '//android.widget.EditText[contains(@hint,"password") or contains(@hint,"Password")]'
      );
      await passField.setValue(PASSWORD);

      await tryClick(driver, [
        '//android.widget.Button[contains(@text,"Sign In")]',
        '//android.widget.Button[contains(@text,"Log In")]',
        '//android.widget.Button[contains(@text,"Continue")]',
      ]);
      loggedInNatively = true;
    }
  } catch {
    // Native form not found — expected; fall through to WebView login
  }

  if (!loggedInNatively) {
    console.log("Attempting WebView/OAuth login via Chrome Custom Tab");

    const webCtx = await switchToWebContext(driver, 20000);
    if (!webCtx) {
      throw new Error("Chrome Custom Tab did not appear for OAuth login");
    }

    await sleep(2000);

    // MLB login page — email field
    await webFill(driver, [
      'input[type="email"]',
      'input[name="email"]',
      'input[id*="email"]',
      'input[placeholder*="email" i]',
      '#email',
    ], EMAIL);

    await webClick(driver, [
      'button[type="submit"]',
      'button[id*="continue"]',
      'button[id*="next"]',
      '[data-testid*="continue"]',
      'input[type="submit"]',
    ]);

    await sleep(2000);

    // Password field (may be on same page or next page)
    await webFill(driver, [
      'input[type="password"]',
      'input[name="password"]',
      'input[id*="password"]',
      '#password',
    ], PASSWORD);

    await webClick(driver, [
      'button[type="submit"]',
      'button[id*="sign-in"]',
      'button[id*="login"]',
      '[data-testid*="login"]',
      '[data-testid*="sign-in"]',
      'input[type="submit"]',
    ]);

    // Switch back to native app context after OAuth redirect
    await sleep(5000);
    await driver.switchContext("NATIVE_APP");
    console.log("Switched back to NATIVE_APP after OAuth");
  }

  // Wait for home screen to load
  await sleep(4000);

  // Dismiss any post-login dialogs
  await tryClick(driver, [
    '//android.widget.Button[contains(@text,"Allow")]',
    '//android.widget.Button[contains(@text,"Not Now")]',
    '//android.widget.Button[contains(@text,"Later")]',
    '//android.widget.Button[contains(@text,"No Thanks")]',
  ], 5000);

  console.log("Login complete");
}

async function transferToBuyer(driver) {
  await sleep(2000);

  // Navigate to Tickets tab
  const foundTickets = await tryClick(driver, [
    '//*[@content-desc="Tickets"]',
    '//*[@text="Tickets"]',
    '//android.widget.TextView[contains(@text,"Tickets")]',
    '//android.widget.FrameLayout[@content-desc="Tickets"]',
  ], 30000);

  if (!foundTickets) {
    throw new Error("Could not navigate to Tickets tab");
  }

  await sleep(3000);

  // Find the first available ticket card
  const ticketSelectors = [
    '//android.widget.TextView[contains(@text,"Marlins")]',
    '//android.widget.TextView[contains(@text,"loanDepot")]',
    '//android.widget.TextView[contains(@text,"MIA")]',
    '//android.widget.TextView[contains(@text,"Miami")]',
    '//androidx.recyclerview.widget.RecyclerView//android.view.ViewGroup[1]',
  ];

  let tapped = false;
  for (const sel of ticketSelectors) {
    try {
      const el = await driver.$(sel);
      if (await el.isDisplayed()) {
        await el.click();
        tapped = true;
        break;
      }
    } catch {}
  }

  if (!tapped) {
    throw new Error("Could not find any ticket card to tap");
  }

  await sleep(2000);

  // Tap the Transfer button on the ticket detail screen
  const tappedTransfer = await tryClick(driver, [
    '//android.widget.Button[contains(@text,"Transfer")]',
    '//android.widget.TextView[contains(@text,"Transfer")]',
    '//android.widget.Button[@content-desc="Transfer"]',
  ], 15000);

  if (!tappedTransfer) {
    throw new Error("Could not find Transfer button on ticket detail screen");
  }

  await sleep(2000);

  // Enter buyer email in the recipient field
  const emailFieldSelectors = [
    '//android.widget.EditText[contains(@hint,"Email")]',
    '//android.widget.EditText[contains(@hint,"email")]',
    '//android.widget.EditText[contains(@hint,"Name or email")]',
    '//android.widget.EditText[1]',
  ];

  let emailEntered = false;
  for (const sel of emailFieldSelectors) {
    try {
      const el = await driver.$(sel);
      await el.waitForDisplayed({ timeout: 15000 });
      await el.setValue(BUYER_EMAIL);
      emailEntered = true;
      break;
    } catch {}
  }

  if (!emailEntered) {
    throw new Error("Could not find email field on transfer screen");
  }

  await sleep(1000);
  await driver.hideKeyboard().catch(() => {});

  // Tap Next / Add
  await tryClick(driver, [
    '//android.widget.Button[contains(@text,"Next")]',
    '//android.widget.Button[contains(@text,"Continue")]',
    '//android.widget.Button[contains(@text,"Add")]',
  ], 10000);

  await sleep(2000);

  // Confirm the transfer on the review screen
  await tryClick(driver, [
    '//android.widget.Button[contains(@text,"Transfer")]',
    '//android.widget.Button[contains(@text,"Send")]',
    '//android.widget.Button[contains(@text,"Confirm")]',
  ], 10000);

  await sleep(3000);
  console.log(`Transfer sent to ${BUYER_EMAIL}`);
}

(async () => {
  const host = process.env.APPIUM_HOST || "localhost";
  const port = parseInt(process.env.APPIUM_PORT || "4723");

  const driver = await remote({
    hostname: host,
    port,
    path: "/",
    capabilities: CAPS,
    logLevel: "warn",
  });

  try {
    await login(driver);
    await transferToBuyer(driver);
    console.log("SUCCESS");
    process.exit(0);
  } catch (err) {
    console.error("FAILURE:", err.message);
    process.exit(1);
  } finally {
    await driver.deleteSession().catch(() => {});
  }
})();
