import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fromRoot = path => readFileSync(new URL('../' + path, import.meta.url));
const script = fromRoot('smart-horeca-sidebar-brand.js').toString('utf8');
const html = fromRoot('persistent-workspace.html').toString('utf8');
const i18n = fromRoot('sh-i18n.js').toString('utf8');

test('Smart Horeca website uses the approved SH Owner neon mark and business slogan', () => {
  const mark = fromRoot('assets/brand/smarthoreca-owner-mark.webp');
  assert.equal(mark.toString('ascii', 0, 4), 'RIFF');
  assert.equal(mark.toString('ascii', 8, 12), 'WEBP');
  assert.ok(mark.length > 1000, 'logo must be a real image file');
  assert.match(script, /const LOGO='\/assets\/brand\/smarthoreca-owner-mark\.webp\?v=20261028-1'/);
  assert.match(script, /<small data-sh-i18n-source="Управлять бизнесом легко">Управлять бизнесом легко<\/small>/);
  assert.match(script, /font-family:"Space Grotesk"/);
  assert.match(script, /grid-template-columns:64px minmax\(0,1fr\)/);
  assert.match(script, /white-space:normal!important/);
  assert.match(script, /body\.sh-workspace-page\.sh-sidebar-collapsed/);
  assert.match(script, /\.sh-sidebar-collapsed\[data-protected="true"\][\\s\\S]*?sh-exact-brand-copy\{[\\s\\S]*?display:none!important/);
});
test('new branding survives language switching and does not replace navigation', () => {
  assert.match(i18n, /'Управлять бизнесом легко':\['Biznesinizi asanlıqla idarə edin','Manage your business with ease'\]/);
  assert.match(html, /smart-horeca-sidebar-brand\.js\?v=20261028-brand-1/);
  assert.match(html, /sh-i18n\.js\?v=20261028-brand-1/);
  assert.match(script, /const brand=side\?\.querySelector\('\.unified-brand'\)/);
  assert.doesNotMatch(script, /side\.innerHTML=/);
  assert.doesNotMatch(script, /sidebar\.innerHTML=/);
  assert.doesNotMatch(script, /localStorage\.clear\(/);
});
