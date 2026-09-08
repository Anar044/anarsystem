(() => {
  const root = document.getElementById('order-history');
  if (!root) return;

  const esc = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const eventNames = [
    'Заказ создан',
    'Заказ обновлён',
    'Заказ закрыт',
    'Заказ закрывается',
    'Оплата заказа',
    'Применена скидка',
    'Применена надбавка',
    'Добавлено блюдо',
    'Удалено блюдо',
    'Выставлен счёт',
    'Событие'
  ];

  const technicalNames = {
    ordercreated: 'Заказ создан',
    neworder: 'Заказ создан',
    orderupdated: 'Заказ обновлён',
    orderupdate: 'Заказ обновлён',
    orderguestsbill: 'Выставлен счёт',
    closingorder: 'Заказ закрывается',
    closedorder: 'Заказ закрыт',
    orderclosed: 'Заказ закрыт',
    payment: 'Оплата заказа',
    paymentadded: 'Оплата заказа',
    discount: 'Применена скидка',
    orderdiscount: 'Применена скидка',
    increase: 'Применена надбавка',
    surcharge: 'Применена надбавка'
  };

  function cleanText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function titleFor(line) {
    const text = cleanText(line);
    for (const name of eventNames) {
      if (text.startsWith(name)) return { title: name, rest: text.slice(name.length) };
    }

    const compact = text.toLowerCase().replace(/[\s_-]/g, '');
    for (const [key, name] of Object.entries(technicalNames)) {
      if (compact.startsWith(key)) return { title: name, rest: text.slice(key.length) };
    }

    return null;
  }

  function parseLines() {
    const lines = root.innerText
      .split(/\n+/)
      .map(cleanText)
      .filter(Boolean);

    const events = [];
    let current = null;

    for (const line of lines) {
      const parsed = titleFor(line);
      if (parsed) {
        if (current) events.push(current);
        const dateMatch = parsed.rest.match(/(\d{2}\.\d{2}\.\d{4},?\s*\d{2}:\d{2})/);
        current = {
          title: parsed.title,
          time: dateMatch ? dateMatch[1].replace(',', ', ') : '',
          details: []
        };
        const tail = dateMatch ? parsed.rest.slice(dateMatch.index + dateMatch[0].length) : parsed.rest;
        if (cleanText(tail)) current.details.push(cleanText(tail));
      } else if (current) {
        current.details.push(line);
      }
    }

    if (current) events.push(current);
    return events;
  }

  function build() {
    if (!root || root.dataset.historyPolished === '1') return;
    if (root.querySelector('.history-list')) {
      root.dataset.historyPolished = '1';
      return;
    }
    if (!root.innerText.trim()) return;

    const events = parseLines();
    if (!events.length) return;

    root.innerHTML = `<div class="history-list">${events.map((event, index) => {
      const details = event.details
        .map(text => `<span>${esc(text)}</span>`)
        .join('');

      return `<div class="history-row">
        <span class="history-dot" aria-hidden="true"></span>
        <div class="history-main">
          <div class="history-top">
            <strong>${esc(event.title)}</strong>
            <time>${esc(event.time || '—')}</time>
          </div>
          <div class="history-info">${details || '<span><b>Информация</b>Событие заказа</span>'}</div>
        </div>
      </div>`;
    }).join('')}</div>`;

    root.dataset.historyPolished = '1';
  }

  const observer = new MutationObserver(() => {
    if (root.dataset.historyPolished !== '1') build();
  });

  observer.observe(root, { childList: true, subtree: true, characterData: true });
  build();
})();
