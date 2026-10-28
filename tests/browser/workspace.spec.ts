import { test, expect } from '@playwright/test';
test('team workspace: onboarding, projects, board, collaboration, search, MCP and mobile', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Ваше имя', exact: true }).fill('Павел');
  await page.getByRole('textbox', { name: 'Название команды', exact: true }).fill('Студия Север');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('owner@example.test');
  await page.getByRole('textbox', { name: 'Пароль', exact: true }).fill('test-owner-password');
  await page.getByRole('checkbox', { name: 'Добавить примеры проектов и задач' }).check();
  await page.getByRole('button', { name: 'Создать пространство', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Всё под контролем, Павел' })).toBeVisible();
  await page.screenshot({ path: 'test-results/overview-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Новый проект', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Название проекта' }).fill('Мобильное приложение');
  await dialog.getByRole('textbox', { name: 'Код проекта' }).fill('MOB');
  await dialog
    .getByRole('textbox', { name: 'О чём этот проект' })
    .fill('Выпустить первый релиз для команды.');
  await dialog.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Мобильное приложение', exact: true }),
  ).toBeVisible();
  const projectHash = new URL(page.url()).hash;
  await page.getByRole('button', { name: 'Новая задача', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Название задачи' }).fill('Собрать первый прототип');
  await dialog
    .getByRole('combobox', { name: 'Ответственный', exact: true })
    .selectOption({ label: 'Павел' });
  await dialog.getByRole('combobox', { name: 'Приоритет', exact: true }).selectOption('high');
  await dialog.getByLabel('Срок', { exact: true }).fill('2026-12-05');
  await dialog.getByLabel('Метки через запятую').fill('Дизайн, MVP');
  await dialog.getByRole('button', { name: 'Создать задачу', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Собрать первый прототип', exact: true }),
  ).toBeVisible();
  const card = page.locator('.task-card').filter({ hasText: 'Собрать первый прототип' });
  await card.dragTo(
    page
      .locator('.board-column')
      .filter({ has: page.getByRole('heading', { name: 'В работе', exact: true }) }),
  );
  await expect(
    page
      .locator('.board-column')
      .filter({ has: page.getByRole('heading', { name: 'В работе', exact: true }) })
      .getByRole('button', { name: 'Собрать первый прототип', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Собрать первый прототип', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox', { name: 'Статус', exact: true })).toHaveValue('doing');
  await expect(dialog.getByLabel('Срок', { exact: true })).toHaveValue('2026-12-05');
  await dialog
    .getByRole('textbox', { name: 'Комментарий', exact: true })
    .fill('Первый вариант готов к обсуждению');
  await dialog.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(
    dialog.getByText('Первый вариант готов к обсуждению', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('link', { name: 'Команда', exact: false }).click();
  await page.getByRole('textbox', { name: 'Email приглашённого' }).fill('member@example.test');
  await page.getByRole('button', { name: 'Пригласить', exact: true }).click();
  const inviteLink = await page.getByRole('textbox', { name: 'Ссылка приглашения' }).inputValue();
  expect(inviteLink).toContain('?invite=');
  const memberContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4180' });
  const member = await memberContext.newPage();
  await member.goto(inviteLink);
  await member.getByRole('textbox', { name: 'Ваше имя', exact: true }).fill('Анна');
  await expect(member.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue(
    'member@example.test',
  );
  await member.getByRole('textbox', { name: 'Пароль', exact: true }).fill('test-member-password');
  await member.getByRole('button', { name: 'Присоединиться', exact: true }).click();
  await expect(member.getByRole('heading', { name: 'Всё под контролем, Анна' })).toBeVisible();
  await member.goto(`/${projectHash}`);
  await member.getByRole('button', { name: 'Собрать первый прототип', exact: true }).click();
  await member
    .getByRole('dialog')
    .getByRole('combobox', { name: 'Статус', exact: true })
    .selectOption('review');
  await member
    .getByRole('dialog')
    .getByRole('combobox', { name: 'Ответственный', exact: true })
    .selectOption({ label: 'Анна' });
  await member.getByRole('dialog').getByRole('button', { name: 'Сохранить', exact: true }).click();
  await member.getByRole('link', { name: 'Команда', exact: false }).click();
  await expect(member.getByRole('button', { name: 'Пригласить', exact: true })).toHaveCount(0);
  await memberContext.close();
  await page.goto(`/${projectHash}`);
  await page.getByRole('button', { name: 'Собрать первый прототип', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('combobox', { name: 'Статус', exact: true }),
  ).toHaveValue('review');
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.keyboard.press('Meta+k');
  await page.getByRole('textbox', { name: 'Глобальный поиск', exact: true }).fill('MOB-1');
  await expect(
    page.getByRole('dialog').getByRole('button', { name: /Собрать первый прототип/ }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'MCP и AI' }).click();
  await page.getByRole('textbox', { name: 'Название подключения' }).fill('Browser test');
  await page.getByRole('combobox', { name: 'Права', exact: true }).selectOption('read');
  await page.getByRole('button', { name: 'Создать токен', exact: true }).click();
  await expect(page.locator('.token-result')).toContainText('fj_');
  await expect(page.locator('.token-row')).toContainText('Browser test');
  await page.reload();
  await expect(page.locator('.token-result')).toHaveCount(0);
  await expect(page.locator('.token-row')).toContainText('Browser test');
  await page.getByRole('link', { name: 'Обзор', exact: true }).click();
  await page.getByRole('button', { name: /Требуют внимания/ }).click();
  await expect(page.getByRole('heading', { name: 'Все задачи', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Просроченные', exact: true })).toHaveClass(
    /selected/,
  );
  await page.goto(`/${projectHash}`);
  await page.screenshot({ path: 'test-results/board-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#overview');
  await expect(page.getByRole('heading', { name: 'Всё под контролем, Павел' })).toBeVisible();
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.inner);
  await page.screenshot({ path: 'test-results/overview-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
  await page.getByRole('link', { name: 'Проекты', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Мобильное приложение', exact: true }).click();
  await page.getByRole('button', { name: 'Новая задача', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const dialogWidth = await page.getByRole('dialog').boundingBox();
  expect(dialogWidth!.width).toBeLessThanOrEqual(390);
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  expect(errors).toEqual([]);
});
