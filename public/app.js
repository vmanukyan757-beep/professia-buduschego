(function () {
  'use strict';
  var T = window.TREE;
  var app = document.getElementById('app');
  var statsEl = document.getElementById('stats');

  var node = 'login';   // 'login' | 'intro' | id узла | 'PICK' | 'L:...'
  var hist = [];           // пройденные шаги: { id, q, a }
  var rated = null;        // оценка, которую поставил этот посетитель
  var userName = null;     // имя / ник для учёта уникальных пользователей

  try { rated = Number(localStorage.getItem('p2035_rated')) || null; } catch (e) { /* нет доступа */ }
  try { userName = localStorage.getItem('p2035_user') || null; } catch (e) { /* ignore */ }

  // ---------- Сервер ----------
  function api(url, body) {
    return fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  function showStats(s) {
    if (!s || typeof s.visits !== 'number') return;
    var f = function (n) { return Number(n).toLocaleString('ru-RU'); };
    var parts = [f(s.visits) + ' заходов', f(s.completions) + ' прошли'];
    if (typeof s.users === 'number' && s.users > 0) parts.push(f(s.users) + ' польз.');
    if (s.ratingCount) parts.push(String(s.ratingAvg).replace('.', ',') + '★');
    statsEl.textContent = parts.join(' · ');
    statsEl.hidden = false;
  }
  function initStats() {
    var seen = false;
    try { seen = sessionStorage.getItem('p2035_visit') === '1'; } catch (e) { /* ignore */ }
    var p = seen ? api('/api/stats') : api('/api/visit', { user: userName || undefined });
    p.then(function (s) {
      showStats(s);
      if (!seen) { try { sessionStorage.setItem('p2035_visit', '1'); } catch (e) { /* ignore */ } }
    }).catch(function () { /* без сервера счётчики просто не показываются */ });
  }

  // ---------- Вспомогательное ----------
  function risk(r) {
    if (r >= 85) return ['low', 'Очень низкий риск замены ИИ'];
    if (r >= 75) return ['low', 'Низкий риск замены ИИ'];
    if (r >= 65) return ['mid', 'Умеренный риск: нужен навык работы с ИИ'];
    return ['mid', 'Повышенный риск: нужно сильное владение ИИ-инструментами'];
  }
  function applyWidths() {
    var els = app.querySelectorAll('[data-w]');
    requestAnimationFrame(function () {
      for (var i = 0; i < els.length; i++) els[i].style.width = els[i].getAttribute('data-w') + '%';
    });
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------- Экраны ----------
  function login() {
    app.innerHTML =
      '<div class="card">' +
      '<h1>Профессия будущего</h1>' +
      '<p class="muted">Чтобы точнее считать, сколько людей проходит тест, введите имя или ник. Это нужно один раз — данные остаются только у вас в браузере.</p>' +
      '<label class="field"><span>Ваше имя или ник</span>' +
      '<input type="text" id="userInput" maxlength="32" placeholder="Например: Анна" autocomplete="nickname" autofocus></label>' +
      '<button class="btn" data-a="login">Войти и начать</button>' +
      '<p class="small muted">Мы не просим почту и не храним настоящий IP. Имя нужно только для счётчика уникальных пользователей.</p>' +
      '</div>';
    var input = document.getElementById('userInput');
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') document.querySelector('[data-a="login"]').click();
      });
    }
  }

  function intro() {
    app.innerHTML =
      '<div class="card">' +
      '<h1>Какая профессия подойдёт вам и не исчезнет из-за ИИ?</h1>' +
      '<p class="muted">Отвечайте «да» или «нет» — без правильных и неправильных ответов. Каждый шаг приближает вас к профессии, которая действительно может подойти.</p>' +
      (userName ? '<p class="small muted">Вы вошли как <b>' + escapeHtml(userName) + '</b></p>' : '') +
      '<div class="facts">' +
      '<div class="fact"><b>10–15</b><span>вопросов до результата</span></div>' +
      '<div class="fact"><b>5</b><span>сфер на выбор</span></div>' +
      '<div class="fact"><b>' + Object.keys(T.leaves).length + '</b><span>профессий в каталоге</span></div></div>' +
      '<button class="btn" data-a="start">Начать тест</button>' +
      '<p class="small muted">Это ориентир для размышлений, а не научный тест. Оценки устойчивости к ИИ нужны для сравнения профессий и не являются точным прогнозом.</p>' +
      '</div>';
  }

  function question() {
    var n = T.nodes[node];
    var chip = n.d === 'gate' ? 'Выбираем сферу' : T.domains[n.d].name;
    app.innerHTML =
      '<div class="card">' +
      '<div class="qtop"><span>Вопрос ' + (hist.length + 1) + ' · <span class="chip">' + chip + '</span></span>' +
      (hist.length ? '<button class="btn ghost sm" data-a="back">Назад</button>' : '<span></span>') + '</div>' +
      '<h2 class="q" id="q">' + n.q + '</h2>' +
      '<div class="yn" role="group" aria-labelledby="q">' +
      '<button class="btn" data-a="yes">Да</button><button class="btn ghost" data-a="no">Нет</button></div>' +
      '</div>';
  }

  function pick() {
    var keys = Object.keys(T.domains);
    app.innerHTML =
      '<div class="card">' +
      '<div class="qtop"><span>Вопрос ' + (hist.length + 1) + '</span><button class="btn ghost sm" data-a="back">Назад</button></div>' +
      '<h2 class="q" id="q">Пока ни одна сфера не зацепила. Какая из них ближе?</h2>' +
      '<div class="opts" role="group" aria-labelledby="q">' +
      keys.map(function (k) { return '<button class="opt" data-a="domain" data-k="' + k + '">' + T.domains[k].name + '</button>'; }).join('') +
      '</div></div>';
  }

  function detail(l) {
    return '<dl class="dl">' +
      '<div><dt>Почему устойчива</dt><dd>' + l.why + '</dd></div>' +
      '<div><dt>Как работать с ИИ</dt><dd>' + l.ai + '</dd></div>' +
      '<div><dt>Первый шаг</dt><dd>' + l.go + '</dd></div></dl>';
  }

  function ratingBlock() {
    var stars = '';
    for (var i = 1; i <= 5; i++) {
      stars += '<button class="star' + (rated && i <= rated ? ' on' : '') + '" data-a="rate" data-v="' + i + '" aria-label="' + i + ' из 5">★</button>';
    }
    return '<div class="card"><h3>' + (rated ? 'Спасибо за оценку' : 'Оцените сайт') + '</h3>' +
      '<div class="stars" role="group" aria-label="Оценка сайта">' + stars + '</div>' +
      '<p class="small muted" id="rateMsg">' + (rated ? 'Оценку можно изменить: нажмите другую звезду.' : 'Это займёт секунду и поможет улучшить тест.') + '</p></div>';
  }

  function result(id) {
    var l = T.leaves[id];
    var rk = risk(l.r);
    var alts = l.alt.map(function (a) { return T.leaves[a]; });
    app.innerHTML =
      '<div class="card top">' +
      '<span class="badge">Ваша профессия</span>' +
      '<h2>' + l.n + '</h2>' +
      '<div class="metrics"><div class="metric"><label>Сфера</label><b class="plain">' + T.domains[l.d].name + '</b></div>' +
      '<div class="metric"><label>Устойчивость к ИИ</label><b>' + l.r + '/100</b><div class="meter res"><i data-w="' + l.r + '"></i></div></div></div>' +
      '<span class="tag ' + rk[0] + '">' + rk[1] + '</span>' +
      detail(l) + '</div>' +
      '<h3>Похожие профессии</h3>' +
      '<div class="list">' + alts.map(function (a) {
        var k = risk(a.r);
        return '<details><summary><span class="name">' + a.n + '</span><span class="tag ' + k[0] + '">' + k[1] + ' · ' + a.r + '/100</span></summary><div class="inner">' + detail(a) + '</div></details>';
      }).join('') + '</div>' +
      '<details><summary><span class="name">Как мы к этому пришли</span></summary><div class="inner"><ol class="path">' +
      hist.map(function (h) { return '<li>' + h.q + ' <b>' + h.a + '</b></li>'; }).join('') + '</ol></div></details>' +
      ratingBlock() +
      '<p class="note">Устойчивость к ИИ здесь выражает оценку автора сайта: чем больше в работе физического присутствия, ответственности и человеческого контакта, тем выше балл. Рынок труда меняется, поэтому используйте результат как повод изучить профессию подробнее.</p>' +
      '<div class="row"><button class="btn" data-a="copy" id="copyBtn">Скопировать результат</button><button class="btn ghost" data-a="restart">Пройти заново</button></div>' +
      '<div id="fb" hidden></div>';
    window.__share = 'Мой результат в «Профессия будущего»: ' + l.n + ' (устойчивость к ИИ ' + l.r + '/100).';
    applyWidths();
    api('/api/complete', { leaf: id, user: userName || undefined }).then(showStats).catch(function () {});
  }

  function render() {
    if (node === 'login') login();
    else if (node === 'intro') intro();
    else if (node === 'PICK') pick();
    else if (node.indexOf('L:') === 0) result(node.slice(2));
    else question();
    window.scrollTo(0, 0);
  }

  function answer(yes) {
    var n = T.nodes[node];
    hist.push({ id: node, q: n.q, a: yes ? 'Да' : 'Нет' });
    node = yes ? n.y : n.n;
    render();
  }

  // ---------- События ----------
  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-a]');
    if (!b) return;
    var a = b.getAttribute('data-a');
    if (a === 'login') {
      var input = document.getElementById('userInput');
      var name = (input && input.value || '').trim().slice(0, 32);
      if (!name || name.length < 2) {
        if (input) { input.focus(); input.style.borderColor = 'var(--warn)'; }
        return;
      }
      userName = name;
      try { localStorage.setItem('p2035_user', name); } catch (err) { /* ignore */ }
      api('/api/login', { user: name }).then(showStats).catch(function () {});
      node = 'intro';
      render();
    }
    else if (a === 'start') { hist = []; node = T.start; render(); }
    else if (a === 'yes') answer(true);
    else if (a === 'no') answer(false);
    else if (a === 'domain') {
      hist.push({ id: 'PICK', q: 'Какая сфера ближе?', a: T.domains[b.getAttribute('data-k')].name });
      node = T.domains[b.getAttribute('data-k')].entry; render();
    }
    else if (a === 'back') { if (hist.length) { node = hist.pop().id; render(); } }
    else if (a === 'restart') { hist = []; node = 'intro'; render(); }
    else if (a === 'rate') {
      var v = Number(b.getAttribute('data-v'));
      api('/api/rate', { stars: v }).then(function (s) {
        rated = v;
        try { localStorage.setItem('p2035_rated', String(v)); } catch (err) { /* ignore */ }
        showStats(s);
        var stars = app.querySelectorAll('.star');
        for (var i = 0; i < stars.length; i++) stars[i].classList.toggle('on', i < v);
        var m = document.getElementById('rateMsg'); if (m) m.textContent = 'Спасибо! Ваша оценка: ' + v + ' из 5.';
      }).catch(function () {
        var m = document.getElementById('rateMsg'); if (m) m.textContent = 'Не удалось отправить оценку. Попробуйте позже.';
      });
    }
    else if (a === 'copy') {
      var t = window.__share, btn = b, fb = document.getElementById('fb');
      var fallback = function () {
        fb.hidden = false; fb.innerHTML = '<textarea id="shareTa" rows="3" readonly></textarea>';
        var ta = document.getElementById('shareTa'); ta.value = t; ta.focus(); ta.select();
      };
      try {
        navigator.clipboard.writeText(t).then(function () {
          btn.textContent = 'Скопировано';
          setTimeout(function () { btn.textContent = 'Скопировать результат'; }, 2000);
        }, fallback);
      } catch (err) { fallback(); }
    }
  });

  // Если имя уже есть — сразу на intro, иначе login
  node = userName ? 'intro' : 'login';
  render();
  initStats();
})();
