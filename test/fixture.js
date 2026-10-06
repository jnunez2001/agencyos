// Joshua Nunez
// A database with two agencies. Agency A is the one the tests mostly use; agency B exists to prove isolation.
const { openDb } = require('../server/db');
const orgs = require('../server/services/organizations');
const members = require('../server/services/members');

const PASSWORD = 'correct horse battery';

async function fixture() {
  const db = openDb(':memory:');
  const a = await orgs.createOrganization(db, { organizationName: 'Whalls Agency', displayName: 'Josh', username: 'josh', password: PASSWORD });
  const ctxOf = (organizationId, id, role) => ({ organizationId, actor: { id, role }, ip: '127.0.0.1', source: 'web' });
  const josh = ctxOf(a.organizationId, a.userId, 'owner');
  const add = async (username, displayName, role) => {
    const m = await members.createMember(db, josh, { username, displayName, role, password: PASSWORD });
    return { id: m.id, ctx: ctxOf(a.organizationId, m.id, role) };
  };
  const rayne = await add('rayne', 'Rayne', 'admin');
  const mark = await add('mark', 'Mark', 'manager');
  const sarah = await add('sarah', 'Sarah', 'employee');
  const cole = await add('cole', 'Cole', 'contractor');
  const b = await orgs.createOrganization(db, { organizationName: 'Other Agency', displayName: 'Zed', username: 'zed', password: PASSWORD });
  return {
    db,
    orgId: a.organizationId,
    josh, rayne: rayne.ctx, mark: mark.ctx, sarah: sarah.ctx, cole: cole.ctx,
    ids: { josh: a.userId, rayne: rayne.id, mark: mark.id, sarah: sarah.id, cole: cole.id, zed: b.userId },
    zed: ctxOf(b.organizationId, b.userId, 'owner'),
    otherOrgId: b.organizationId,
    ctxOf,
  };
}

module.exports = { fixture, PASSWORD };
