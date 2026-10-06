// Joshua Nunez
// What each role may do. One place decides, the server checks it on every request, and the screens only hide
// what the server would refuse. The matrix is in docs/specs/2026-10-06-phase-1-foundation.md.
const ROLES = ['owner', 'admin', 'manager', 'employee', 'contractor'];
const RANK = { owner: 5, admin: 4, manager: 3, employee: 2, contractor: 1 };

const ALL = ROLES;
const OWNER_ADMIN = ['owner', 'admin'];
const MANAGERS = ['owner', 'admin', 'manager'];
const NOT_CONTRACTOR = ['owner', 'admin', 'manager', 'employee'];

const ACTIONS = {
  'org.view': ALL,
  'org.update': OWNER_ADMIN,
  'members.list': ['owner', 'admin', 'manager', 'employee'],
  'members.create': OWNER_ADMIN,
  'members.manage': OWNER_ADMIN,
  'profile.edit_others': OWNER_ADMIN,
  'profile.edit_self': ALL,
  'activity.view': OWNER_ADMIN,
  'dashboard.team': MANAGERS,
  'clients.view': NOT_CONTRACTOR,
  'clients.manage': MANAGERS,
  'projects.view': NOT_CONTRACTOR,
  'projects.manage': MANAGERS,
  // Everyone sees tasks; a Contractor only the ones assigned to them (the task service enforces that).
  'tasks.view': ALL,
  'tasks.manage': MANAGERS,
  // Change the status of a task assigned to you, and comment on a task you can see.
  'tasks.work': ALL,
  'dashboard.agency': NOT_CONTRACTOR,
  // Everyone connects their own AI as themselves. Owner and Admin also see and decide everyone's.
  'ai.use': ALL,
  'ai.manage': OWNER_ADMIN,
  'ai.approve': OWNER_ADMIN,
};

function can(role, action) {
  const allowed = ACTIONS[action];
  return !!allowed && allowed.includes(role);
}

// An owner can manage anyone. Everyone else can manage only members of a lower rank, and only if they hold
// the permission to manage members at all (checked separately with can()).
function canManage(actorRole, targetRole) {
  if (!RANK[actorRole] || !RANK[targetRole]) return false;
  if (!can(actorRole, 'members.manage')) return false;
  return actorRole === 'owner' || RANK[actorRole] > RANK[targetRole];
}

// The roles an actor may give to someone: an owner any role, an admin only roles below admin.
function assignableRoles(actorRole) {
  if (!can(actorRole, 'members.manage')) return [];
  if (actorRole === 'owner') return [...ROLES];
  return ROLES.filter((r) => RANK[r] < RANK[actorRole]);
}

module.exports = { ROLES, RANK, ACTIONS, can, canManage, assignableRoles };
