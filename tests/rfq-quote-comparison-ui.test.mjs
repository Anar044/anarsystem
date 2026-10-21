import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../procurement.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../procurement.css', import.meta.url), 'utf8');
const start = source.indexOf('function quoteComparisonHtml(r){');
const end = source.indexOf('\nfunction rfqStatusLabel(', start);
assert.ok(start >= 0 && end > start, 'RFQ price renderer is present');

const esc = v => String(v ?? '').replace(/[&<>"']/g, m => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[m]));
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const quoteLineByProduct = (quote, id) =>
  (quote?.lines || []).find(x => String(x.productId) === String(id)) || null;

function render(data, mode = 'compact') {
  const localStorage = { getItem: () => mode === 'details' ? 'details' : null };
  const quoteComparisonHtml = new Function(
    'quoteLineByProduct','num','key','qty','esc','money','localStorage',
    source.slice(start, end) + ';return quoteComparisonHtml;'
  )(quoteLineByProduct, num, String, String, esc,
    x => num(x).toFixed(2) + ' ₼', localStorage);
  return quoteComparisonHtml(data);
}

const fixture = {
  id: 'pr-123', status: 'APPROVED',
  lines: [
    { productId:'beef', productName:'Говядина', unit:'кг', quantity:10,
      packageCount:4, packageSize:2.5, vatPercent:0 },
    { productId:'eggs', productName:'Яйца', unit:'шт', quantity:30,
      packageCount:1, packageSize:30, vatPercent:0 }
  ],
  quotes: [
    { id:'bravo',supplierName:'Bravo & Co',totalAmount:33,deliveryDays:2,
      paymentTerms:'Предоплата',validUntil:'2026-11-01',
      createdAt:'2026-10-21T10:00:00Z',comment:'До склада',
      lines:[
        { productId:'beef',unitPrice:6,packageSize:2.5,packageCount:4,total:24,vatPercent:0 },
        { productId:'eggs',unitPrice:9,packageSize:30,packageCount:1,total:9,vatPercent:0 }
      ]
    },
    { id:'bazar',supplierName:'Bazar',totalAmount:20,
      lines:[{ productId:'beef',unitPrice:10,packageSize:5,packageCount:2,total:20,vatPercent:0 }]
    }
  ]
};

test('RFQ matrix is compact, safe and normalizes prices across different package sizes', () => {
  const html = render(fixture);
  assert.match(html, /data-quote-layout="compact"/);
  assert.match(html, /data-quote-layout-mode="details"/);
  assert.doesNotMatch(html, /proc-quote-summary-grid/);
  assert.match(html, /Bravo &amp; Co/);
  assert.match(html, /Условия предложения/);
  assert.match(html, /Нет предложения/);
  assert.equal((html.match(/class="quote-price-cell best"/g) || []).length, 2,
    'Bazar wins on beef unit price; Bravo wins on eggs');
  assert.match(html, /2\.00 ₼/);
  assert.match(html, /2\.40 ₼/);
  assert.match(html, /data-quote-layout-mode="compact" aria-pressed="true"/);
});

test('detailed mode keeps the original commercial conditions and accounting amounts', () => {
  const html = render(fixture, 'details');
  assert.match(html, /data-quote-layout="details"/);
  assert.match(html, /data-quote-layout-mode="details" aria-pressed="true"/);
  for (const text of ['Фасовка', 'Количество', 'Цена за упаковку', 'НДС', 'Доставка',
    'Оплата', 'Действует до', 'Получено', 'Предоплата', 'До склада']) {
    assert.ok(html.includes(text), text);
  }
  assert.match(html, /24\.00 ₼/);
  assert.match(html, /20\.00 ₼/);
});

test('PO actions retain their approved-only gating and supplier IDs', () => {
  const before = JSON.stringify(fixture);
  const html = render(fixture);
  assert.match(html, /data-po-create="pr-123" data-quote="bravo"/);
  assert.match(html, /data-po-create="pr-123" data-quote="bazar"/);
  assert.match(html, /data-po-split="pr-123"/);
  assert.equal(JSON.stringify(fixture), before, 'rendering must not mutate quote amounts');
  const draft = render({...fixture,status:'DRAFT'});
  assert.doesNotMatch(draft, /data-po-create=/);
  assert.doesNotMatch(draft, /data-po-split=/);
});

test('layout switching is delegated without replacing the PO handler', () => {
  assert.match(source, /if\(b\.dataset\.quoteLayoutMode\)/);
  assert.match(source, /setAttribute\('aria-pressed'/);
  assert.match(source, /localStorage\.setItem\('shProcQuoteLayoutV1'/);
  assert.match(source, /if\(b\.dataset\.poCreate\)return createPoFromQuote/);
  assert.match(styles, /\.proc-quote-comparison\[data-quote-layout="details"\] \.quote-cell-details/);
  assert.match(styles, /\.proc-quote-comparison \.quote-product-cell/);
  assert.match(styles, /position:sticky/);
});
