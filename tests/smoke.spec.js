const { test, expect } = require('@playwright/test');

const APP_URL = 'file:///C:/Users/keibl/OneDrive/Documents/GitHub/oddsapi/index.html';
const API_BASE = 'https://api.the-odds-api.com/v4';

function wireMockRoutes(page) {
  page.route(`${API_BASE}/sports/*/events/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'evt-1',
          sport_key: 'soccer_epl',
          sport_title: 'Soccer EPL',
          commence_time: '2099-01-01T10:00:00Z',
          home_team: 'Alpha FC',
          away_team: 'Beta FC'
        }
      ])
    });
  });

  page.route(`${API_BASE}/sports/*/scores/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'evt-old-1',
          sport_key: 'soccer_epl',
          sport_title: 'Soccer EPL',
          commence_time: '2025-01-01T10:00:00Z',
          completed: true,
          home_team: 'Alpha FC',
          away_team: 'Beta FC',
          scores: [
            { name: 'Alpha FC', score: '2' },
            { name: 'Beta FC', score: '1' }
          ]
        }
      ])
    });
  });

  page.route(`${API_BASE}/sports/*/odds/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'evt-1',
          sport_key: 'soccer_epl',
          sport_title: 'Soccer EPL',
          commence_time: '2099-01-01T10:00:00Z',
          home_team: 'Alpha FC',
          away_team: 'Beta FC',
          bookmakers: [
            {
              key: 'sportsbet',
              last_update: '2099-01-01T09:00:00Z',
              markets: [
                {
                  key: 'h2h',
                  outcomes: [
                    { name: 'Alpha FC', price: 1.8 },
                    { name: 'Beta FC', price: 2.1 },
                    { name: 'Draw', price: 3.2 }
                  ]
                }
              ]
            }
          ]
        }
      ])
    });
  });

  page.route(`${API_BASE}/sports/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          key: 'soccer_epl',
          title: 'Soccer EPL',
          group: 'Soccer',
          active: true,
          has_outrights: false
        },
        {
          key: 'basketball_nba',
          title: 'Basketball NBA',
          group: 'Basketball',
          active: true,
          has_outrights: false
        }
      ])
    });
  });
}

async function login(page, apiKey = 'real_key_123456') {
  await page.goto(APP_URL);
  await expect(page.locator('#apiKeyModal')).toHaveClass(/is-open/);
  await page.fill('#apiKeyInput', apiKey);
  await page.click('#saveApiKeyBtn');
}

test('login, catalog load, and secure mode toggle', async ({ page }) => {
  wireMockRoutes(page);
  await login(page);

  await expect(page.locator('#tableWrap')).toContainText('Soccer EPL');

  await page.click('#settingsBtn');
  await page.click('#secureModeToggleBtn');
  await expect(page.locator('#secureModeToggleBtn')).toContainText('Secure Mode: On');

  await expect(page.locator('#savedApiKeySelect')).toHaveClass(/hidden/);
});

test('refresh restores current view', async ({ page }) => {
  wireMockRoutes(page);
  await login(page);

  await page.click('[data-range="today"]');
  await expect(page.locator('#pageTitle')).toContainText('Upcoming Games');

  await page.reload();
  await expect(page.locator('#pageTitle')).toContainText('Upcoming Games');
});

test('favorites lifecycle and mobile card labels', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 430, height: 920 } });
  wireMockRoutes(page);
  await login(page);

  const firstStar = page.locator('.star-btn').first();
  await firstStar.click();

  await page.click('#settingsBtn');
  await page.click('.scope-btn[data-scope="favorites"]');

  await expect(page.locator('#pageTitle')).toContainText('Favourites Catalog');
  await expect(page.locator('.star-btn.remove-btn').first()).toBeVisible();

  await page.close();
});
