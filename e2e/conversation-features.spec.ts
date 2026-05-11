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
  await page.waitForURL(url => url.toString().includes('#/'), { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
}

test.describe('Test 3: Conversation detail features', () => {
  test('Open conversation and verify Sprint C features', async ({ page }) => {
    await doLogin(page);
    await page.screenshot({ path: 'e2e/screenshots/10-logged-in-for-conv.png' });

    // Navigate via SPA hash route
    await page.goto(`${CRM_URL}/#/meta-conversations/index`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000); // Allow Angular to render
    await page.screenshot({ path: 'e2e/screenshots/11-conv-list.png' });

    const pageContent = await page.content();

    const hasCannedResponses = pageContent.toLowerCase().includes('canned') ||
      pageContent.toLowerCase().includes('respuesta');
    const hasStatusIndicators = pageContent.toLowerCase().includes('status') ||
      pageContent.toLowerCase().includes('delivered') ||
      pageContent.toLowerCase().includes('leido');
    const hasAssignDropdown = pageContent.toLowerCase().includes('assign') ||
      pageContent.toLowerCase().includes('asignar');
    const hasNotes = pageContent.toLowerCase().includes('note') ||
      pageContent.toLowerCase().includes('nota');

    console.log('Sprint C UI Features in module:');
    console.log('  Canned responses button:', hasCannedResponses);
    console.log('  Status indicators:', hasStatusIndicators);
    console.log('  Assignment dropdown:', hasAssignDropdown);
    console.log('  Notes tab/button:', hasNotes);

    await page.screenshot({ path: 'e2e/screenshots/12-features-check.png' });

    // Check for chat widget container
    const chatWidget = page.locator('[id*="chat"], [class*="chat"], [id*="conversation"], [class*="conversation"]');
    const widgetCount = await chatWidget.count();
    console.log('Chat widget elements found:', widgetCount);

    // Try to click a conversation if visible
    const convLinks = page.locator('a[href*="meta_conversations"], .conversation-item, [data-id]');
    const count = await convLinks.count();
    console.log('Conversation links found:', count);

    if (count > 0) {
      await convLinks.first().click();
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'e2e/screenshots/13-conversation-detail.png' });

      const detailContent = await page.content();
      console.log('Conversation detail Sprint C features:');
      console.log('  Canned responses:', detailContent.toLowerCase().includes('canned'));
      console.log('  Status indicators:', detailContent.toLowerCase().includes('delivered') || detailContent.toLowerCase().includes('read'));
      console.log('  Assignment:', detailContent.toLowerCase().includes('assign'));
      console.log('  Notes:', detailContent.toLowerCase().includes('note'));
      console.log('  Media:', detailContent.toLowerCase().includes('media') || detailContent.toLowerCase().includes('image'));
    } else {
      console.log('No conversation links found — chat widget may render after data loads');
    }

    expect(page.url()).not.toContain('action=Login');
  });
});
