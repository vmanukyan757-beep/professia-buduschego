'use strict';
// Проверка целостности дерева: node test/tree.test.js
const T = require('../public/tree.js');
const assert = require('assert');

const errors = [];
const leavesSeen = new Set();
const nodesSeen = new Set();

function check(ref, from) {
  if (ref === 'PICK') return;
  if (ref.startsWith('L:')) {
    const id = ref.slice(2);
    if (!T.leaves[id]) errors.push(`${from}: нет профессии ${id}`);
    leavesSeen.add(id);
    return;
  }
  if (!T.nodes[ref]) errors.push(`${from}: нет узла ${ref}`);
}

for (const [id, n] of Object.entries(T.nodes)) {
  assert(n.q && n.y && n.n, `узел ${id} неполный`);
  check(n.y, id);
  check(n.n, id);
}
for (const [k, d] of Object.entries(T.domains)) {
  if (!T.nodes[d.entry]) errors.push(`сфера ${k}: нет входа ${d.entry}`);
}
for (const [id, l] of Object.entries(T.leaves)) {
  assert(T.domains[l.d], `профессия ${id}: неизвестная сфера`);
  assert(l.r >= 0 && l.r <= 100, `профессия ${id}: r вне диапазона`);
  for (const a of l.alt) if (!T.leaves[a]) errors.push(`${id}: alt ${a} не существует`);
  if (l.alt.includes(id)) errors.push(`${id}: ссылается сам на себя`);
}

// Обход всех путей от первого вопроса (PICK разворачивается в входы всех сфер)
let minD = Infinity, maxD = 0;
function walk(id, depth, stack) {
  if (stack.includes(id)) { errors.push('цикл: ' + stack.concat(id).join(' > ')); return; }
  nodesSeen.add(id);
  const n = T.nodes[id];
  for (const nxt of [n.y, n.n]) {
    if (nxt === 'PICK') {
      for (const d of Object.values(T.domains)) walk(d.entry, depth + 2, stack.concat(id));
    } else if (nxt.startsWith('L:')) {
      minD = Math.min(minD, depth); maxD = Math.max(maxD, depth);
    } else walk(nxt, depth + 1, stack.concat(id));
  }
}
walk(T.start, 1, []);

for (const id of Object.keys(T.nodes)) if (!nodesSeen.has(id)) errors.push('недостижимый узел ' + id);
for (const id of Object.keys(T.leaves)) if (!leavesSeen.has(id)) errors.push('недостижимая профессия ' + id);

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`OK: узлов ${Object.keys(T.nodes).length}, профессий ${Object.keys(T.leaves).length}, вопросов в пути от ${minD} до ${maxD}`);

// Сценарий автора: «да» на первый вопрос и инженерные ответы не должны давать врача
function run(answers) {
  let id = T.start, i = 0;
  while (true) {
    const n = T.nodes[id];
    const nxt = answers[i++] ? n.y : n.n;
    if (nxt.startsWith('L:')) return nxt.slice(2);
    id = nxt;
  }
}
// Путь: Да (eng) → Нет (не софт) → Нет (не энергия) → Да (роботы) → Да (программировать) → Да (механика+код) = robotics
assert.strictEqual(run([1, 0, 0, 1, 1, 1]), 'robotics', 'инженерия, железо, роботы, программирование: инженер робототехники');
assert.strictEqual(T.leaves[run([1, 1, 1])].d, 'eng', 'первый «Да» должен вести в инженерию');
assert.strictEqual(T.leaves[run([0, 1, 1, 1])].d, 'med', 'Нет, потом Да ведёт в медицину');
console.log('Сценарии маршрутизации: OK');
