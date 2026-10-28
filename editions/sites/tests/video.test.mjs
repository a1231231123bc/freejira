import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analysisSchema,
  validateAnalysis,
  matchingMember,
  matchingDate,
} from '../lib/video/contract.ts';
const task = {
  id: 'T1',
  title: 'Исправить кнопку',
  type: 'bug',
  priority: 'high',
  description: 'Кнопка не сохраняет данные',
  acceptance_criteria: ['Данные сохраняются'],
  location: 'Карточка задачи',
  time: '00:03',
  frames: ['f_0003.jpg'],
  quote: 'Кнопка не работает',
  assignee: '',
  due: '',
  confidence: 'high',
};
const analysis = () => ({
  title: 'Проверка CRM',
  summary: 'Не работает сохранение. Нужно исправить кнопку. После исправления проверить результат.',
  screens: [{ time: '00:03', frame: 'f_0003.jpg', description: 'Карточка задачи' }],
  tasks: [structuredClone(task)],
  open_questions: [],
  entities: [],
});
const frames = [{ name: 'f_0003.jpg', time: 3 }],
  transcript = [{ start: 2, end: 5, text: 'Кнопка не работает' }];
test('accepts a supported grounded model response', () =>
  assert.equal(
    validateAnalysis(analysis(), frames, 10, transcript, true).tasks[0].confidence,
    'high',
  ));
test('rejects wrong schema, duplicate IDs, invented frame/time/quote', () => {
  assert.equal(analysisSchema.safeParse({ ...analysis(), extra: 'no' }).success, false);
  for (const patch of [
    { frames: ['f_0999.jpg'] },
    { time: '99:99' },
    { time: '01:00' },
    { quote: 'несуществующая цитата' },
  ]) {
    const a = analysis();
    Object.assign(a.tasks[0], patch);
    assert.throws(() => validateAnalysis(a, frames, 10, transcript, true));
  }
  const a = analysis();
  a.tasks.push(structuredClone(task));
  assert.throws(() => validateAnalysis(a, frames, 10, transcript, true));
});
test('silent and visual-only tasks always become low confidence', () => {
  const a = analysis();
  a.tasks[0].quote = '';
  assert.equal(validateAnalysis(a, frames, 10, [], false).tasks[0].confidence, 'low');
  assert.equal(validateAnalysis(a, frames, 10, transcript, true).tasks[0].confidence, 'low');
});
test('only unambiguous active members are matched', () => {
  const members = [
    { id: '1', name: 'Иван Петров', active: 1 },
    { id: '2', name: 'Иван Иванов', active: 1 },
    { id: '3', name: 'Мария', active: 0 },
  ];
  assert.equal(matchingMember('Иван', members), null);
  assert.equal(matchingMember('Иван Петров', members), '1');
  assert.equal(matchingMember('Иван Петрв', members), '1');
  assert.equal(matchingMember('Мария', members), null);
});
test('dates are resolved from upload date, ambiguity remains empty', () => {
  assert.equal(matchingDate('завтра', '2026-12-31'), '2027-01-01');
  assert.equal(matchingDate('29.02.2027', '2026-10-27'), null);
  assert.equal(matchingDate('2028-02-29', '2026-10-27'), '2028-02-29');
  assert.equal(matchingDate('к следующей пятнице', '2026-10-27'), null);
});
