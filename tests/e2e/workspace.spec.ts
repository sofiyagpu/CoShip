import { test, expect } from '@playwright/test';
test('create, use, discuss, share, copy and archive an application', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /София Ким/ }).click();
  await expect(page.getByRole('heading', { name: /^Приложения\s*\d*$/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/workspace-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Создать приложение', exact: true }).first().click();
  const name = `E2E Tracker ${Date.now()}`;
  await page.getByLabel('Название приложения', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Создать и опубликовать' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const appId = page.url().split('#app/')[1];
  const frame = page.frameLocator(`iframe[title="${name}"]`);
  await frame.getByLabel('Новая запись').fill('Реальная запись');
  await frame.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(frame.getByText('Реальная запись', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Комментарии', exact: true }).click();
  await page.getByLabel('Комментарий', { exact: true }).fill('Проверено в браузере');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.getByText('Проверено в браузере', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Поделиться', exact: true }).click();
  await page.getByLabel('Сотрудник или группа').selectOption('user:demo-anna');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.getByLabel('Права: Анна Ли')).toBeVisible();
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await page.getByRole('button', { name: /Анна Ли/ }).click();
  await page.goto(`/#app/${appId}`);
  await page.reload();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const viewer = page.frameLocator(`iframe[title="${name}"]`);
  await expect(viewer.getByText('Реальная запись', { exact: true })).toBeVisible();
  await viewer.getByLabel('Новая запись').fill('Запрещённая запись');
  await viewer.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(viewer.getByRole('alert')).toContainText('нет прав');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await page.getByRole('button', { name: /София Ким/ }).click();
  await page.goto(`/#app/${appId}`);
  await page.reload();
  await page.getByRole('button', { name: 'Копия', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('пустой базой');
  await page.getByRole('button', { name: 'Все приложения', exact: true }).click();
  await page.getByPlaceholder('Найти приложение…').fill(`${name} — копия`);
  await page
    .getByRole('button', { name: new RegExp(`${name} — копия`) })
    .filter({ has: page.locator('h3') })
    .click();
  await expect(
    page.frameLocator('iframe').getByText('Пока нет записей.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Настройки', exact: true }).last().click();
  await page.getByRole('button', { name: 'Отправить в архив', exact: true }).click();
  await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('в архиве');
});
test('mobile dashboard remains navigable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: /София Ким/ }).click();
  await expect(page.getByRole('heading', { name: /^Приложения\s*\d*$/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/workspace-mobile.png', fullPage: true });
});

test('welcome motion can be paused, respects reduced motion, and is removed after login', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/lenis/);
  await expect(page.locator('.welcome-vanta canvas')).toHaveCount(1);
  await page.getByRole('button', { name: 'Приостановить анимацию фона' }).click();
  await expect(page.locator('.welcome-vanta canvas')).toHaveCount(0);
  await page.getByRole('button', { name: 'Включить анимацию фона' }).click();
  await expect(page.locator('.welcome-vanta canvas')).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.welcome-vanta canvas')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveClass(/lenis/);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('html')).toHaveClass(/lenis/);
  await page.getByRole('button', { name: /София Ким/ }).click();
  await expect(page.locator('.global-header')).toBeVisible();
  await expect(page.locator('.welcome-vanta')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveClass(/lenis/);
});
