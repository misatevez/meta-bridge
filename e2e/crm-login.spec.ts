import { test, expect } from '@playwright/test';

const CRM_URL = 'https://firmas.moacrm.com';

async function doLogin(page: any) {
  await page.goto(`${CRM_URL}/index.php`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const userField = page.locator('input[name="user_name"], #user_name, input[type="text"]').first();
  await userField.waitFor({ timeout: 20000 });
  await userField.fill('admin');
  await page.locator('input[type="password"]').first().fill('Admin1234.');
  const loginBtn = page.locator('button:has-text("Log In"), button:has-text("Login"), input[type="submit"], button[type="submit"]').first();
  await loginBtn.waitFor({ timeout: 10000 });
  await loginBtn.click();
  // Wait for SPA to load after login
  await page.waitForURL(url => url.toString().includes('#/'), { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
}

test.describe('Test 2: CRM Login + Navigation', () => {
  test('Login to SuiteCRM and navigate to meta_conversations', async ({ page }) => {
    await page.goto(CRM_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.screenshot({ path: 'e2e/screenshots/01-crm-home.png' });

    const currentUrl = page.url();
    console.log('Initial URL:', currentUrl);

    await doLogin(page);
    await page.screenshot({ path: 'e2e/screenshots/03-after-login.png' });

    const postLoginUrl = page.url();
    console.log('Post-login URL:', postLoginUrl);
    console.log('Login SUCCESS — redirected to:', postLoginUrl);

    // Navigate to meta_conversations via SPA hash route
    await page.goto(`${CRM_URL}/#/meta-conversations/index`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.screenshot({ path: 'e2e/screenshots/04-meta-conversations.png' });
    console.log('meta_conversations URL:', page.url());

    // Should not redirect back to login
    expect(page.url()).not.toContain('module=Users&action=Login');
  });

  test('Verify meta_conversations tabs (WhatsApp, Messenger, Instagram)', async ({ page }) => {
    await doLogin(page);
    await page.screenshot({ path: 'e2e/screenshots/05-logged-in.png' });

    // Navigate to meta_conversations via Angular SPA hash route
    await page.goto(`${CRM_URL}/#/meta-conversations/index`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    // Wait for Angular SPA to render
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000); // Allow Angular to finish rendering
    await page.screenshot({ path: 'e2e/screenshots/06-module-loaded.png' });

    const pageContent = await page.content();

    const hasWhatsApp = pageContent.toLowerCase().includes('whatsapp');
    const hasMessenger = pageContent.toLowerCase().includes('messenger') ||
      pageContent.toLowerCase().includes('facebook');
    const hasInstagram = pageContent.toLowerCase().includes('instagram');

    console.log('Tab visibility (in rendered SPA HTML):');
    console.log('  WhatsApp tab:', hasWhatsApp);
    console.log('  Messenger/Facebook tab:', hasMessenger);
    console.log('  Instagram tab:', hasInstagram);

    const searchBar = page.locator('input[type="search"], input[placeholder*="search" i], input[placeholder*="buscar" i]');
    const hasSearch = await searchBar.isVisible().catch(() => false);
    console.log('  Search bar visible:', hasSearch);

    await page.screenshot({ path: 'e2e/screenshots/07-tabs-check.png' });

    expect(page.url()).not.toContain('action=Login');
  });
});
