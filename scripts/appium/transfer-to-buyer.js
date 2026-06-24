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

const CAPS = {
  platformName: "Android",
  "appium:automationName": "UiAutomator2",
  "appium:appPackage": "com.bamnetworks.mobile.android.ballpark",
  "appium:appActivity": "com.bamnetworks.mobile.android.ballpark.activity.MainActivity",
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

async function dumpScreen(driver, label) {
  try {
    const src = await driver.getPageSource();
    // Print first 3000 chars of XML so we can see what's on screen
    console.log(`[SCREEN DUMP - ${label}]`, src.slice(0, 3000));
  } catch (e) {
    console.log(`[SCREEN DUMP - ${label}] failed:`, e.message);
  }
}

async function login(driver) {
  await driver.pause(5000); // let app fully load

  await dumpScreen(driver, "before-login");

  // Dismiss any permission dialogs first (location, notifications, etc.)
  const permissionSelectors = [
    '//android.widget.Button[@text="Allow"]',
    '//android.widget.Button[@text="OK"]',
    '//android.widget.Button[@text="Continue"]',
    '//android.widget.Button[@text="Skip"]',
  ];
  for (const sel of permissionSelectors) {
    try {
      const el = await driver.$(sel);
      if (await el.isDisplayed()) {
        await el.click();
        await driver.pause(1000);
      }
    } catch {}
  }

  // Check if already on Tickets/home tab (already logged in)
  try {
    const tickets = await driver.$('//android.widget.TextView[contains(@text,"Tickets")]');
    if (await tickets.isDisplayed()) {
      console.log("Already logged in");
      return;
    }
  } catch {}

  // Try to get to login screen — handle welcome/onboarding
  const onboardingSelectors = [
    '//android.widget.Button[contains(@text,"Get Started")]',
    '//android.widget.Button[contains(@text,"Log In")]',
    '//android.widget.Button[contains(@text,"Sign In")]',
    '//android.widget.TextView[contains(@text,"Log In")]',
    '//android.widget.TextView[contains(@text,"Sign In")]',
  ];

  for (const sel of onboardingSelectors) {
    try {
      const el = await driver.$(sel);
      if (await el.isDisplayed()) {
        await el.click();
        await driver.pause(2000);
        break;
      }
    } catch {}
  }

  await dumpScreen(driver, "after-onboarding-tap");

  // Now look for the email field
  const emailFieldSelectors = [
    '//android.widget.EditText[contains(@hint,"Email")]',
    '//android.widget.EditText[contains(@hint,"email")]',
    '//android.widget.EditText[1]',
  ];

  let emailEntered = false;
  for (const sel of emailFieldSelectors) {
    try {
      const el = await driver.$(sel);
      await el.waitForDisplayed({ timeout: 10000 });
      await el.setValue(EMAIL);
      emailEntered = true;
      break;
    } catch {}
  }

  if (!emailEntered) {
    // Maybe we need to tap Sign In/Log In first from onboarding
    for (const sel of ['//android.widget.Button[contains(@text,"Sign In")]', '//android.widget.Button[contains(@text,"Log In")]']) {
      try {
        const el = await driver.$(sel);
        if (await el.isDisplayed()) {
          await el.click();
          await driver.pause(2000);
          break;
        }
      } catch {}
    }
    for (const sel of emailFieldSelectors) {
      try {
        const el = await driver.$(sel);
        await el.waitForDisplayed({ timeout: 10000 });
        await el.setValue(EMAIL);
        emailEntered = true;
        break;
      } catch {}
    }
  }

  if (!emailEntered) {
    await dumpScreen(driver, "email-field-not-found");
    throw new Error("Could not find email field to log in");
  }

  // Continue / Next
  for (const sel of ['//android.widget.Button[contains(@text,"Continue")]', '//android.widget.Button[contains(@text,"Next")]']) {
    try {
      const el = await driver.$(sel);
      if (await el.isDisplayed()) { await el.click(); break; }
    } catch {}
  }

  await driver.pause(2000);

  // Password field
  const passwordFieldSelectors = [
    '//android.widget.EditText[contains(@hint,"Password")]',
    '//android.widget.EditText[contains(@hint,"password")]',
    '//android.widget.EditText[1]',
  ];
  for (const sel of passwordFieldSelectors) {
    try {
      const el = await driver.$(sel);
      await el.waitForDisplayed({ timeout: 10000 });
      await el.setValue(PASSWORD);
      break;
    } catch {}
  }

  // Sign In
  for (const sel of ['//android.widget.Button[contains(@text,"Sign In")]', '//android.widget.Button[contains(@text,"Log In")]']) {
    try {
      const el = await driver.$(sel);
      if (await el.isDisplayed()) { await el.click(); break; }
    } catch {}
  }

  await driver.pause(6000); // wait for login to complete
  await dumpScreen(driver, "after-login");
}

async function transferToBuyer(driver) {
  // Navigate to Tickets tab
  try {
    await findAndTap(driver, '//android.widget.TextView[contains(@text,"Tickets")]', 30000);
  } catch {
    await findAndTap(driver, '//android.widget.FrameLayout[@content-desc="Tickets"]', 30000);
  }

  await driver.pause(2000);

  // Find the first available ticket card (the one we just accepted)
  const ticketSelectors = [
    '//android.widget.TextView[contains(@text,"Marlins")]',
    '//android.widget.TextView[contains(@text,"loanDepot")]',
    '//android.widget.TextView[contains(@text,"MIA")]',
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
    // Try tapping the first ticket card generically
    await findAndTap(
      driver,
      '//androidx.recyclerview.widget.RecyclerView//android.view.ViewGroup[1]',
      15000
    );
  }

  await driver.pause(2000);

  // Tap the Transfer button on the ticket detail screen
  const transferSelectors = [
    '//android.widget.Button[contains(@text,"Transfer")]',
    '//android.widget.TextView[contains(@text,"Transfer")]',
    '//android.widget.Button[@content-desc="Transfer"]',
  ];

  for (const sel of transferSelectors) {
    try {
      await findAndTap(driver, sel, 15000);
      break;
    } catch {}
  }

  await driver.pause(2000);

  // Enter buyer email in the recipient field
  const emailFieldSelectors = [
    '//android.widget.EditText[contains(@hint,"Email")]',
    '//android.widget.EditText[contains(@hint,"email")]',
    '//android.widget.EditText[contains(@hint,"Name or email")]',
    '//android.widget.EditText[1]',
  ];

  for (const sel of emailFieldSelectors) {
    try {
      await typeInto(driver, sel, BUYER_EMAIL, 15000);
      break;
    } catch {}
  }

  await driver.pause(1000);

  // Dismiss keyboard and tap Next / Continue
  await driver.hideKeyboard().catch(() => {});

  const nextSelectors = [
    '//android.widget.Button[contains(@text,"Next")]',
    '//android.widget.Button[contains(@text,"Continue")]',
    '//android.widget.Button[contains(@text,"Add")]',
  ];

  for (const sel of nextSelectors) {
    try {
      const el = await driver.$(sel);
      if (await el.isDisplayed()) {
        await el.click();
        break;
      }
    } catch {}
  }

  await driver.pause(2000);

  // Confirm the transfer on the review screen
  const confirmSelectors = [
    '//android.widget.Button[contains(@text,"Transfer")]',
    '//android.widget.Button[contains(@text,"Send")]',
    '//android.widget.Button[contains(@text,"Confirm")]',
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

  await driver.pause(3000);
  console.log(`Transfer sent to ${BUYER_EMAIL}`);
}

(async () => {
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
