import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolveRestaurantScope, restaurantDirectory, allowedDepartmentIds } from '../functions/api/iiko/_lib/restaurant-scope.js';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = read('functions/api/iiko/_lib/ai-assistant-context.js');
const handler = read('functions/api/ai-assistant.js');
const userState = read('functions/api/iiko/_lib/user-state.js');

const departments = ['r1', 'r2', 'r3', 'r4'].map((id, index) => ({
  id, name: 'Restaurant ' + (index + 1), code: String(index + 1)
}));
const savedState = {
  connection: { ip: 'example.az', port: '8080', login: 'api', password: 'not-for-browser',
    connectionType: 'CHAIN', organizationId: 'r1', departments, departmentIds: departments.map(row => row.id) },
  identity: { mode: 'CHAIN', organizationId: 'r1', departmentIds: departments.map(row => row.id), departments,
    organizations: departments, groups: departments.map(row => ({ id: 'group-' + row.id, departmentId: row.id })),
    pointsOfSale: departments.map(row => ({ id: 'pos-' + row.id, groupId: 'group-' + row.id })),
    restaurantSections: [] }
};
const admin = {
  allowed: true, isOwner: false, userId: 'login-user-id', storageUserId: 'platform-org:org1', workspace: { id: 'workspace-org1' },
  scope: { mode: 'ALL', departmentIds: [], departmentCodes: [] },
  permissions: ['*']
};
const member = {
  ...admin, userId: 'restaurant-manager', isOwner: false,
  scope: { mode: 'SELECTED', departmentIds: ['r2'], departmentCodes: ['2'] },
  permissions: ['assistant.use', 'reports.olap']
};

function harness(stored = { found: true, state: savedState, access: admin }) {
  const calls = [];
  const sandbox = {
    structuredClone, URL, Set, Error,
    loadRequestIikoState: async (request, env) => {
      calls.push({ request, env });
      return stored;
    },
    privateConnection: state => state.connection,
    hasPrivateConnection: state => Boolean(state?.connection?.ip && state?.connection?.password),
    restaurantDirectory, resolveRestaurantScope, allowedDepartmentIds,
    hasPermission: (access, permission) => Boolean(access?.permissions?.includes('*') || access?.permissions?.includes(permission))
  };
  const executable = source.replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
  runInNewContext(executable + '\n globalThis.functions={resolveAssistantIiko,scopeStateForAssistant,assistantToolAuthorized};', sandbox);
  return { ...sandbox.functions, calls };
}
const request = cookie => new Request('https://smarthoreca.pages.dev/api/ai-assistant', {
  headers: cookie ? { Cookie: cookie } : {}
});

test('AI route uses workspace-aware connection resolver for status, dialogs and messages', () => {
  assert.match(handler, /import \{ resolveAssistantIiko, assistantToolAuthorized \}/);
  assert.doesNotMatch(handler, /loadPrivateIikoState\(env\.DB,\s*auth\.user\.id/);
  assert.match(handler, /resolveAssistantIiko\(env,\s*request\)/);
  assert.match(handler, /resolveAssistantIiko\(env,\s*request,\s*Array\.isArray\(body\.departmentIds\)/);
  assert.match(userState, /access\.storageUserId \|\| access\.ownerUserId \|\| auth\.user\.id/);
});

test('Organization admin connects to the 4 restaurants via workspace storage, not login ID', async () => {
  const h = harness();
  const req = request('sh_selected_departments=r1%2Cr2%2Cr3%2Cr4');
  const result = await h.resolveAssistantIiko({ DB: {} }, req, ['r1', 'r2', 'r3', 'r4']);
  assert.equal(result.connected, true);
  assert.equal(result.access.storageUserId, 'platform-org:org1');
  assert.equal(result.connection.password, savedState.connection.password);
  assert.deepEqual(Array.from(result.scope.selectedDepartmentIds), ['r1', 'r2', 'r3', 'r4']);
  assert.equal(h.calls[0].request, req);
});

test('SELECTED member gets only their restaurant, groups, and sale places', async () => {
  const h = harness({ found: true, state: savedState, access: member });
  const result = await h.resolveAssistantIiko({}, request('sh_selected_departments=r2'), ['r2']);
  assert.deepEqual(Array.from(result.scope.selectedDepartmentIds), ['r2']);
  assert.deepEqual(Array.from(result.scope.allowedDepartmentIds), ['r1', 'r2', 'r3', 'r4']);
  assert.ok(result.scope.selectedDepartmentIds.length < result.scope.allowedDepartmentIds.length,
    'CHAIN OLAP must enforce Department filtering for one-restaurant employees');
  assert.deepEqual(Array.from(result.scope.selectedGroupIds), ['group-r2']);
  assert.deepEqual(Array.from(result.scope.selectedPointOfSaleIds), ['pos-r2']);
  assert.equal(result.connection.password, savedState.connection.password);
  assert.equal(result.state.connection.organizationId, undefined);
  assert.equal(result.state.identity.organizationId, undefined);
  assert.equal(savedState.identity.departmentIds.length, 4, 'D1 snapshot is never mutated');
});

test('Rejects a restaurant outside an employee grant even if it is in the original server', async () => {
  const h = harness({ found: true, state: savedState, access: member });
  await assert.rejects(() => h.resolveAssistantIiko({}, request('sh_selected_departments=r1'), ['r1']),
    error => error.status === 403 && error.code === 'CHAIN_SCOPE_FORBIDDEN');
  await assert.rejects(() => h.resolveAssistantIiko({}, request('sh_selected_departments=r2'), ['r1']),
    error => error.status === 403 && error.code === 'CHAIN_SCOPE_SELECTION_FORBIDDEN');
});

test('AI rejects a stale narrower browser scope instead of using all cookie-selected restaurants', async () => {
  const h = harness();
  await assert.rejects(() => h.resolveAssistantIiko({}, request('sh_selected_departments=r1%2Cr2'), ['r1']),
    error => error.status === 403 && error.code === 'CHAIN_SCOPE_SELECTION_MISMATCH');
  await assert.rejects(() => h.resolveAssistantIiko({}, request(), ['r1']),
    error => error.status === 403 && error.code === 'CHAIN_SCOPE_SELECTION_MISMATCH');
  const matched = await h.resolveAssistantIiko({}, request('sh_selected_departments=r2'), ['r2']);
  assert.deepEqual(Array.from(matched.scope.selectedDepartmentIds), ['r2']);
});

test('Workspace switch rejects the previous organization selection instead of using its data', async () => {
  const otherState = structuredClone(savedState);
  otherState.identity.departmentIds = ['other'];
  otherState.identity.departments = [{ id: 'other', name: 'Other restaurant', code: '9' }];
  otherState.identity.organizations = otherState.identity.departments;
  otherState.identity.organizationId = 'other';
  otherState.connection.departmentIds = ['other'];
  otherState.connection.departments = otherState.identity.departments;
  otherState.connection.organizationId = 'other';
  const h = harness({ found: true, state: otherState, access: { ...admin, storageUserId: 'platform-org:org2' } });
  await assert.rejects(() => h.resolveAssistantIiko({}, request('sh_selected_departments=r1'), ['r1']),
    error => error.status === 403 && error.code === 'CHAIN_SCOPE_FORBIDDEN');
});

test('Missing workspace membership and assistant permission block access', async () => {
  const noAccess = harness({ found: false, accessDenied: true, access: { allowed: false, reason: 'WORKSPACE_SELECTION_REQUIRED' } });
  await assert.rejects(() => noAccess.resolveAssistantIiko({}, request()),
    error => error.status === 403 && error.code === 'WORKSPACE_SELECTION_REQUIRED');
  const noPermission = harness({ found: true, state: savedState, access: { ...member, permissions: ['reports.olap'] } });
  await assert.rejects(() => noPermission.resolveAssistantIiko({}, request()),
    error => error.status === 403 && error.code === 'ASSISTANT_ACCESS_DENIED');
});

test('Missing server is reported as not configured without using credentials from another workspace', async () => {
  const h = harness({ found: false, state: null, access: admin });
  const result = await h.resolveAssistantIiko({}, request());
  assert.equal(result.connected, false);
  assert.equal(result.connection, null);
});

test('Data tools require source-specific permissions and purchasing prices require cost permission', () => {
  const h = harness();
  assert.equal(h.assistantToolAuthorized(member, 'run_olap_report'), true);
  assert.equal(h.assistantToolAuthorized(member, 'analyze_purchase_prices'), false);
  assert.equal(h.assistantToolAuthorized(admin, 'analyze_purchase_prices'), true);
  assert.equal(h.assistantToolAuthorized({ ...member, permissions: ['assistant.use'] }, 'run_olap_report'), false);
  assert.equal(h.assistantToolAuthorized(member, 'unknown_tool'), false);
});
