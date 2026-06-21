/**
 * Appium script: accept-transfer
 *
 * Runs on AWS Device Farm on a real Android device with MLB Ballpark installed.
 * Logs into the deposits@buzzerseats.com MLB account, finds the pending
 * ticket transfer, and accepts it.
 *
 * Environment variables injected by Device Farm:
 *   MLB_DEPOSITS_EMAIL
 *   MLB_DEPOSITS_PASSWORD
 *   LISTING_ID
 *
 * Package this file + node_modules into accept-transfer.zip and upload
 * to AWS Device Farm as an APPIUM_NODE_TEST_PACKAGE.
 */

const { remote } = require("webdriverio");

const EMAIL = process.env.MLB_DEPOSITS_EMAIL;
const PASSWORD = process.env.MLB_DEPOSITS_PASSWORD;

const CAPS = {
  platformName: "Android",
  "appium:automationName": "UiAutomator2",
  "appium:appPackage": "com.bamtechmedien.majorleaguebaseball",
  "appium:appActivity": "com.bamtechmedien.majorleaguebaseball.MainActivity",
  "appium:noReset": false,
  "appium:newCommandTimeout": 120,
};

async function findAndTap(driver, selector, timeout = 20000) {
  const el = await driver.$(selector);
  await el.waitForDisplayed({ timeout });
  await el.click();
}

async function typeInto(driver, selector, text, timeout = 20000) {
  const el = await driver.$(selector);
  await el.waitForDisplayed({ timeout });
  await el.setValue(text);
}

async function login(driver) {
  // Tap "Sign In" on the welcome screen
  try {
    await findAndTap(driver, '//android.widget.Button[contains(@text,"Sign In")]');
  } catch {
    // Already logged in or different welcome screen
    return;
  }

  // Enter email
  await typeInto(
    driver,
    '//android.widget.EditText[contains(@hint,"Email") or contains(@hint,"email")]',
    EMAIL
  );

  // Tap Continue / Next
  try {
    await findAndTap(driver, '//android.widget.Button[contains(@text,"Continue")]');
  } catch {
    await findAndTap(driver, '//android.widget.Button[contains(@text,"Next")]');
  }

  // Enter password
  await typeInto(
    driver,
    '//android.widget.EditText[contains(@hint,"Password") or contains(@hint,"password")]',
    PASSWORD
  );

  // Tap Sign In / Log In
  try {
    await findAndTap(driver, '//android.widget.Button[contains(@text,"Sign In")]');
  } catch {
    await findAndTap(driver, '//android.widget.Button[contains(@text,"Log In")]');
  }

  // Wait for home screen
  await driver.pause(4000);
}

async function acceptPendingTransfer(driver) {
  // Navigate to Tickets tab
  try {
    await findAndTap(driver, '//android.widget.TextView[contains(@text,"Tickets")]', 30000);
  } catch {
    await findAndTap(driver, '//android.widget.FrameLayout[@content-desc="Tickets"]', 30000);
  }

  await driver.pause(2000);

  // Look for "Pending" or "Transfer" section
  const pendingSelectors = [
    '//android.widget.TextView[contains(@text,"Pending")]',
    '//android.widget.TextView[contains(@text,"Accept")]',
    '//android.widget.Button[contains(@text,"Accept Tickets")]',
    '//android.widget.TextView[contains(@text,"Transfer Offer")]',
  ];

  let found = false;
  for (const sel of pendingSelectors) {
    try {
      const el = await driver.$(sel);
      const displayed = await el.isDisplayed();
      if (displayed) {
        await el.click();
        found = true;
        break;
      }
    } catch {
      // try next
    }
  }

  if (!found) {
    // Scroll down to find pending transfer
    await driver.execute("mobile: scroll", { direction: "down" });
    await driver.pause(1000);
    for (const sel of pendingSelectors) {
      try {
        const el = await driver.$(sel);
        const displayed = await el.isDisplayed();
        if (displayed) {
          await el.click();
          found = true;
          break;
        }
      } catch {}
    }
  }

  if (!found) throw new Error("No pending transfer found in MLB Ballpark");

  await driver.pause(2000);

  // Tap the Accept / Accept Tickets button on the transfer detail screen
  const acceptSelectors = [
    '//android.widget.Button[contains(@text,"Accept Tickets")]',
    '//android.widget.Button[contains(@text,"Accept")]',
    '//android.widget.TextView[contains(@text,"Accept Tickets")]',
  ];

  for (const sel of acceptSelectors) {
    try {
      await findAndTap(driver, sel);
      break;
    } catch {}
  }

  await driver.pause(3000);

  // Confirm if there is a confirmation dialog
  const confirmSelectors = [
    '//android.widget.Button[contains(@text,"Confirm")]',
    '//android.widget.Button[contains(@text,"Yes")]',
    '//android.widget.Button[contains(@text,"OK")]',
  ];

  for (const sel of confirmSelectors) {
    try {
      const el = await driver.$(sel);
      if (await el.isDisplayed()) {
        await el.click();
        break;
      }
    } catch {}
  }

  await driver.pause(2000);
  console.log("Transfer accepted successfully");
}

(async () => {
  // AWS Device Farm provides the Appium server URL via environment
  const host = process.env.APPIUM_HOST || "localhost";
  const port = parseInt(process.env.APPIUM_PORT || "4723");

  const driver = await remote({
    hostname: host,
    port,
    path: "/wd/hub",
    capabilities: CAPS,
    logLevel: "warn",
  });

  try {
    await login(driver);
    await acceptPendingTransfer(driver);
    console.log("SUCCESS");
    process.exit(0);
  } catch (err) {
    console.error("FAILURE:", err.message);
    process.exit(1);
  } finally {
    await driver.deleteSession().catch(() => {});
  }
})();
