// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const { can, ROLES, RANK, canManage, assignableRoles } = require('../server/services/permissions');

const roles = ['owner', 'admin', 'manager', 'employee', 'contractor'];

// The matrix from the spec (docs/specs/2026-10-06-phase-1-foundation.md and phase-2-core-operations.md).
const MATRIX = {
  'org.view': [1, 1, 1, 1, 1],
  'org.update': [1, 1, 0, 0, 0],
  'members.list': [1, 1, 1, 1, 0],
  'members.create': [1, 1, 0, 0, 0],
  'members.manage': [1, 1, 0, 0, 0],
  'profile.edit_others': [1, 1, 0, 0, 0],
  'profile.edit_self': [1, 1, 1, 1, 1],
  'activity.view': [1, 1, 0, 0, 0],
  'dashboard.team': [1, 1, 1, 0, 0],
  'clients.view': [1, 1, 1, 1, 0],
  'clients.manage': [1, 1, 1, 0, 0],
  'projects.view': [1, 1, 1, 1, 0],
  'projects.manage': [1, 1, 1, 0, 0],
  'tasks.view': [1, 1, 1, 1, 1],
  'tasks.manage': [1, 1, 1, 0, 0],
  'tasks.work': [1, 1, 1, 1, 1],
  'dashboard.agency': [1, 1, 1, 1, 0],
  'sops.view': [1, 1, 1, 1, 0],
  'sops.manage': [1, 1, 1, 0, 0],
  'qa.review': [1, 1, 1, 0, 0],
  'ai.use': [1, 1, 1, 1, 1],
  'ai.manage': [1, 1, 0, 0, 0],
  'ai.approve': [1, 1, 0, 0, 0],
};

test('the roles and their ranks', () => {
  assert.deepEqual(ROLES, roles);
  assert.deepEqual(roles.map((r) => RANK[r]), [5, 4, 3, 2, 1]);
});

test('every role and action follows the spec matrix', () => {
  for (const [action, row] of Object.entries(MATRIX)) {
    roles.forEach((role, i) => assert.equal(can(role, action), !!row[i], `${role} ${action}`));
  }
});

test('an unknown role or action is refused', () => {
  assert.equal(can('owner', 'nuclear.launch'), false);
  assert.equal(can('visitor', 'org.view'), false);
  assert.equal(can(undefined, 'org.view'), false);
});

test('an owner can manage anyone else; others only members of a lower rank', () => {
  for (const target of roles) assert.equal(canManage('owner', target), true, `owner over ${target}`);
  assert.equal(canManage('admin', 'owner'), false);
  assert.equal(canManage('admin', 'admin'), false);
  assert.equal(canManage('admin', 'manager'), true);
  assert.equal(canManage('admin', 'employee'), true);
  assert.equal(canManage('admin', 'contractor'), true);
  for (const actor of ['manager', 'employee', 'contractor']) for (const target of roles) assert.equal(canManage(actor, target), false, `${actor} over ${target}`);
});

test('an owner can give any role; an admin only roles below admin', () => {
  assert.deepEqual(assignableRoles('owner'), roles);
  assert.deepEqual(assignableRoles('admin'), ['manager', 'employee', 'contractor']);
  assert.deepEqual(assignableRoles('manager'), []);
  assert.deepEqual(assignableRoles('employee'), []);
});
