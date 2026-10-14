import test from 'node:test';
import assert from 'node:assert/strict';
import {
  visibleMobileOwnerWorkspaces,
  hasAssignedOrganizationAdminRole
} from '../functions/api/mobile/_lib/context.js';

test('active direct owners are visible without a system ADMIN grant', () => {
  const result = visibleMobileOwnerWorkspaces([
    { id: 'ok', name: 'Active', status: 'ACTIVE', memberStatus: 'ACTIVE', isOwner: true },
    { id: 'disabled', status: 'ACTIVE', memberStatus: 'DISABLED', isOwner: true },
    { id: 'suspended', status: 'SUSPENDED', memberStatus: 'ACTIVE', isOwner: true },
    { id: 'employee', status: 'ACTIVE', memberStatus: 'ACTIVE', isOwner: false },
    { id: '', status: 'ACTIVE', memberStatus: 'ACTIVE', isOwner: true }
  ]);
  assert.deepEqual(result, [{
    id: 'ok', name: 'Active', status: 'ACTIVE',
    isOwner: true, mobileEligible: true
  }]);
});

test('authorized SYSADMIN in a synthetic platform organization is visible', () => {
  const entries = [
    { id: 'organization-A', name: 'RMS', ownerUserId: 'platform-org:A',
      memberStatus: 'ACTIVE', status: 'ACTIVE', isOwner: false },
    { id: 'organization-B', name: 'CHAIN', ownerUserId: 'platform-org:B',
      memberStatus: 'ACTIVE', status: 'ACTIVE', isOwner: false }
  ];
  assert.deepEqual(visibleMobileOwnerWorkspaces(entries, new Set(['organization-A'])), [{
    id: 'organization-A', name: 'RMS', status: 'ACTIVE',
    isOwner: false, mobileEligible: true
  }]);
});

test('suspended or disabled organizations remain inaccessible even for SYSADMIN', () => {
  assert.deepEqual(visibleMobileOwnerWorkspaces([
    { id: 'disabled', status: 'ACTIVE', memberStatus: 'DISABLED', isOwner: false },
    { id: 'suspended', status: 'SUSPENDED', memberStatus: 'ACTIVE', isOwner: false }
  ], new Set(['disabled', 'suspended'])), []);
});

test('no workspace survives incomplete status information', () => {
  assert.deepEqual(visibleMobileOwnerWorkspaces([
    { id: 'no-status', isOwner: true },
    { id: 'no-member', status: 'ACTIVE', isOwner: true }
  ]), []);
});

test('system ADMIN role check uses member and synthetic owner together', async () => {
  const calls = [];
  const mockDB = {
    prepare(sql) {
      assert.match(sql, /role\.code='ADMIN'/);
      assert.match(sql, /role\.is_system=1/);
      return {
        bind(member, owner) {
          calls.push([member, owner]);
          return {
            async first() {
              return member === 'approved-member' && owner === 'platform-org:A'
                ? { authorized: 1 } : null;
            }
          };
        }
      };
    }
  };
  assert.equal(await hasAssignedOrganizationAdminRole(mockDB,
    'approved-member', 'platform-org:A'), true);
  assert.equal(await hasAssignedOrganizationAdminRole(mockDB,
    'approved-member', 'platform-org:B'), false);
  assert.equal(await hasAssignedOrganizationAdminRole(mockDB,
    'ordinary-member', 'platform-org:A'), false);
  assert.equal(await hasAssignedOrganizationAdminRole(mockDB,
    '', 'platform-org:A'), false);
  assert.deepEqual(calls, [
    ['approved-member', 'platform-org:A'],
    ['approved-member', 'platform-org:B'],
    ['ordinary-member', 'platform-org:A']
  ]);
});
