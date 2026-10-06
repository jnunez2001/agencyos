// Joshua Nunez
// Fills a local demo database with a small agency so every screen has something to show. Demo data only:
// the agency name says DEMO and the data folder is not committed.  Run: npm run demo:seed, then npm run demo.
const path = require('path');
const config = require('../server/config');
const { openDb } = require('../server/db');
const orgs = require('../server/services/organizations');
const members = require('../server/services/members');
const profiles = require('../server/services/profiles');

const PASSWORD = 'demo-password-123';

(async () => {
  const dir = process.env.DATA_DIR ? config.dataDir : path.join(config.root, 'data-demo');
  const db = openDb(path.join(dir, 'agencyos.db'));
  if (!orgs.needsSetup(db)) {
    console.error(`Refusing to seed: ${dir} already has an agency.`);
    process.exit(1);
  }
  const a = await orgs.createOrganization(db, { organizationName: 'Whalls Agency (DEMO)', displayName: 'Josh Nunez', username: 'josh', password: PASSWORD });
  const owner = { organizationId: a.organizationId, actor: { id: a.userId, role: 'owner' }, ip: '127.0.0.1', source: 'system' };
  const people = [
    ['rayne', 'Rayne', 'admin', { jobTitle: 'Operations Lead', department: 'Operations' }],
    ['mark', 'Mark Cruz', 'manager', { jobTitle: 'Delivery Manager', department: 'SEO' }],
    ['sarah', 'Sarah Lim', 'employee', { jobTitle: 'SEO Specialist', department: 'SEO', weeklyCapacityHours: 32, workDays: [1, 2, 3, 4] }],
    ['cole', 'Cole Reyes', 'contractor', { jobTitle: 'Freelance Writer', department: 'Content', weeklyCapacityHours: 20 }],
  ];
  for (const [username, displayName, role, profile] of people) {
    const m = await members.createMember(db, owner, { username, displayName, role, password: PASSWORD });
    profiles.updateProfile(db, owner, m.id, profile);
  }
  // The demo people have already chosen their own passwords.
  db.prepare('UPDATE users SET must_change_password = 0').run();
  console.log(`Demo agency ready in ${dir}. Sign in as josh, rayne, mark, sarah or cole. The demo password is in scripts/seed-demo.js.`);
})();
