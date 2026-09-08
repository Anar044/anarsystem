(function () {
    'use strict';

    const $ = id => document.getElementById(id);
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

    const num = v => {
        if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
        const x = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
        return Number.isFinite(x) ? x : 0;
    };

    const money = v => new Intl.NumberFormat('ru-RU', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(num(v));

    const qty = v => new Intl.NumberFormat('ru-RU', {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3
    }).format(num(v));

    const percent = v => `${money(v)}%`;

    const today = () => new Date().toISOString().slice(0, 10);
    const daysAgo = days => {
        const d = new Date();
        d.setDate(d.getDate() - days);
        return d.toISOString().slice(0, 10);
    };

    let rows = [];
    let busy = false;
    let activeMetric = 'revenue';

    function setStatus(text, cls = '') {
        const el = $('status');
        if (!el) return;
        el.textContent = text;
        el.className = `status-pill ${cls}`;
    }

    function getConnection() {
        try {
            const value = JSON.parse(localStorage.getItem('iikoConnection') || 'null');
            if (value?.ip && value?.port && value?.login && value?.password) return value;
        } catch (_) {}
        return null;
    }

    function selectedMetrics() {
        return [...document.querySelectorAll('.indicator-box input:checked')].map(x => x.value);
    }

    function metricTitle(metric) {
        return metric === 'quantity'
            ? 'Количество продаж'
            : metric === 'profit'
                ? 'Прибыль'
                : 'Выручка';
    }

    function metricValue(row, metric) {
        return num(row?.[metric]);
    }

    function badge(row, metric) {
        return row?.[`abc_${metric}`] || 'C';
    }

    function distribution(metric) {
        const box = $('distribution');
        if (!box) return;

        const counts = { A: 0, B: 0, C: 0 };
        for (const row of rows) counts[badge(row, metric)]++;

        const total = rows.length || 1;
        box.innerHTML = ['A', 'B', 'C'].map(letter => {
            const share = counts[letter] / total * 100;
            return `
                <div class="dist-row">
                    <span class="dist-label">${letter}</span>
                    <div class="dist-track">
                        <div class="dist-fill ${letter.toLowerCase()}" style="width:${share}%"></div>
                    </div>
                    <span class="dist-value">${percent(share)}</span>
                </div>`;
        }).join('');
    }

    function render() {
        const table = $('resultTable');
        if (!table) return;

        const search = ($('search')?.value || '').trim().toLowerCase();
        const metricList = selectedMetrics();
        if (!metricList.length) {
            activeMetric = 'revenue';
        } else if (!metricList.includes(activeMetric)) {
            activeMetric = metricList[0];
        }

        const visible = search
            ? rows.filter(row => String(row.name || '').toLowerCase().includes(search))
            : rows;

        distribution(activeMetric);

        let head = '<tr><th>№</th><th class="text-left">Наименование</th>';
        for (const metric of metricList) {
            head += `<th>${metricTitle(metric)}</th><th>ABC</th>`;
        }
        head += '<th>Доля</th><th>Накопленная доля</th></tr>';
        table.querySelector('thead').innerHTML = head;

        const body = visible.map((row, index) => {
            let html = `<td>${index + 1}</td><td class="text-left"><b>${esc(row.name)}</b></td>`;
            for (const metric of metricList) {
                const value = metric === 'quantity' ? qty(row[metric]) : money(row[metric]);
                html += `<td class="num">${value}</td><td><span class="abc-badge ${badge(row, metric).toLowerCase()}">${badge(row, metric)}</span></td>`;
            }

            html += `<td class="num">${percent(row[`share_${activeMetric}`] || 0)}</td>`;
            html += `<td class="num">${percent(row[`cumulative_${activeMetric}`] || 0)}</td>`;
            return `<tr>${html}</tr>`;
        }).join('');

        table.querySelector('tbody').innerHTML = body || `
            <tr><td colspan="20" style="text-align:center;padding:35px;color:#7d8b9c">Нет данных</td></tr>`;
        table.querySelector('tfoot').innerHTML = `
            <tr><th colspan="2" class="text-left">ИТОГО</th>${metricList.map(metric =>
                `<th class="num">${metric === 'quantity' ? qty(rows.reduce((s, r) => s + num(r[metric]), 0)) : money(rows.reduce((s, r) => s + num(r[metric]), 0))}</th><th>—</th>`
            ).join('')}<th>—</th><th>—</th></tr>`;

        if ($('rowCount')) $('rowCount').textContent = `${visible.length} ${visible.length === 1 ? 'позиция' : 'позиций'}`;
    }

    async function loadABC() {
        if (busy) return;

        const connection = getConnection();
        if (!connection) {
            setStatus('Нет подключения', 'error');
            $('error').hidden = false;
            $('error').textContent = 'Не найдено подключение к iiko Server. Откройте настройки подключения и подключитесь к iiko.';
            return;
        }

        const from = $('from').value;
        const to = $('to').value;
        if (!from || !to) {
            setStatus('Ошибка', 'error');
            $('error').hidden = false;
            $('error').textContent = 'Укажите период анализа.';
            return;
        }
        if (from > to) {
            setStatus('Ошибка', 'error');
            $('error').hidden = false;
            $('error').textContent = 'Дата начала не может быть позже даты окончания.';
            return;
        }

        busy = true;
        $('run').disabled = true;
        $('error').hidden = true;
        setStatus('Получаем продажи из OLAP…', 'loading');

        try {
            const response = await fetch('/api/iiko/abc', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    ...connection,
                    from,
                    to,
                    abcA: num($('abcA').value) || 80,
                    abcB: num($('abcB').value) || 95
                })
            });

            const text = await response.text();
            let data;
            try {
                data = text ? JSON.parse(text) : {};
            } catch (_) {
                throw new Error(`Сервер вернул не JSON: HTTP ${response.status}`);
            }

            if (!response.ok || data.success === false) {
                throw new Error(data.message || `Ошибка ABC: HTTP ${response.status}`);
            }

            rows = Array.isArray(data.rows) ? data.rows : [];

            render();
            setStatus(`Готово · ${rows.length} позиций`, 'ok');

            if (!rows.length) {
                $('error').hidden = false;
                $('error').textContent = 'За выбранный период iiko не вернул продаж блюд.';
            }
        } catch (error) {
            rows = [];
            render();
            $('error').hidden = false;
            $('error').textContent = error?.message || String(error);
            setStatus('Ошибка', 'error');
        } finally {
            busy = false;
            $('run').disabled = false;
        }
    }

    function exportCsv() {
        if (!rows.length) return;

        const metrics = selectedMetrics();
        const header = ['Наименование', ...metrics.flatMap(m => [metricTitle(m), `ABC ${metricTitle(m)}`])];
        const lines = [header];

        for (const row of rows) {
            lines.push([
                row.name,
                ...metrics.flatMap(m => [row[m], badge(row, m)])
            ]);
        }

        const csv = lines.map(line => line.map(value => {
            const s = String(value ?? '');
            return `"${s.replace(/"/g, '""')}"`;
        }).join(';')).join('\n');

        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ABC_${$('from').value}_${$('to').value}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function init() {
        $('from').value = daysAgo(31);
        $('to').value = today();

        $('run').onclick = loadABC;
        $('export').onclick = exportCsv;
        $('search').oninput = render;
        $('clearSearch').onclick = () => {
            $('search').value = '';
            render();
        };

        document.querySelectorAll('.indicator-box input').forEach(input => {
            input.addEventListener('change', () => {
                if (input.checked) activeMetric = input.value;
                render();
            });
        });

        document.querySelectorAll('.tab').forEach(tab => {
            tab.onclick = () => {
                document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
                tab.classList.add('active');

                if (tab.dataset.tab !== 'abc') {
                    $('error').hidden = false;
                    $('error').textContent = 'ABC уже работает напрямую через отдельный OLAP-запрос. XYZ сделаем следующим этапом после стабилизации ABC.';
                } else {
                    $('error').hidden = true;
                }
            };
        });

        ['from', 'to', 'abcA', 'abcB'].forEach(id => {
            $(id).addEventListener('change', () => {
                if (rows.length && id !== 'from' && id !== 'to') render();
            });
        });

        if (getConnection()) {
            loadABC();
        } else {
            setStatus('Нет подключения', 'error');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
