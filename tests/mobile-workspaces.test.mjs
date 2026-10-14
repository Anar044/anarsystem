import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleMobileOwnerWorkspaces } from '../functions/api/mobile/_lib/context.js';

test('only active owner memberships of active workspaces are listed', () => {
  const result = visibleMobileOwnerWorkspaces([
    { id: 'ok', name: 'Active', status: 'ACTIVE', memberStatus: 'ACTIVE', isOwner: true },
    { id: 'disabled', status: 'ACTIVE', memberStatus: 'DISABLED', isOwner: true },
    { id: 'suspended', status: 'SUSPENDED', memberStatus: 'ACTIVE', isOwner: true },
    { id: 'employee', status: 'ACTIVE', memberStatus: 'ACTIVE', isOwner: false },
    { id: '', status: 'ACTIVE', memberStatus: 'ACTIVE', isOwner: true }
  ]);
  assert.deepEqual(result, [{ id: 'ok', name: 'Active', status: 'ACTIVE', isOwner: true }]);
});

test('no workspace survives incomplete status information', () => {
  assert.deepEqual(visibleMobileOwnerWorkspaces([
    { id: 'no-status', isOwner: true },
    { id: 'no-member', status: 'ACTIVE', isOwner: true }
  ]), []);
});
