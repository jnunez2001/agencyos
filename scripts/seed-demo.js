// Joshua Nunez
// Fills a local demo database with a small agency so every screen has something to show. Demo data only:
// the agency name says DEMO and the data folder is not committed.  Run: npm run demo:seed, then npm run demo.
const path = require('path');
const config = require('../server/config');
const { openDb } = require('../server/db');
const orgs = require('../server/services/organizations');
const members = require('../server/services/members');
const profiles = require('../server/services/profiles');
const clients = require('../server/services/clients');
const projects = require('../server/services/projects');
const tasks = require('../server/services/tasks');
const sops = require('../server/services/sops');
const { todayIn, addDays } = require('../server/services/dates');

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

  // Clients, projects and tasks, with dates counted from today so the dashboard always has overdue and upcoming work.
  const id = (u) => db.prepare('SELECT id FROM users WHERE username = ?').get(u).id;
  const today = todayIn('Asia/Manila');
  const day = (n) => addDays(today, n);
  const acme = clients.createClient(db, owner, { name: 'Acme Dental', industry: 'Dental', website: 'https://acme-dental.example', notes: 'Prefers updates by email on Fridays.' });
  const bloom = clients.createClient(db, owner, { name: 'Bloom Florist', industry: 'Retail', website: 'https://bloom.example' });
  clients.createClient(db, owner, { name: 'Harbor Law', industry: 'Legal', status: 'paused' });
  clients.addContact(db, owner, acme.id, { name: 'Dr. Ana Lee', email: 'ana@acme-dental.example', roleTitle: 'Owner', isPrimary: true });
  clients.addContact(db, owner, acme.id, { name: 'Front desk', phone: '555 0100' });
  clients.addContact(db, owner, bloom.id, { name: 'Mia Torres', email: 'mia@bloom.example', roleTitle: 'Manager', isPrimary: true });
  const site = projects.createProject(db, owner, { clientId: acme.id, name: 'New website', status: 'active', description: 'Rebuild the practice website with online booking.', startDate: day(-14), dueDate: day(30), managerId: id('mark') });
  const seo = projects.createProject(db, owner, { clientId: acme.id, name: 'Local SEO', status: 'active', description: 'Google Business Profile and citations.', startDate: day(-30), dueDate: day(60), managerId: id('mark') });
  const shop = projects.createProject(db, owner, { clientId: bloom.id, name: 'Online shop', status: 'planning', startDate: day(7), dueDate: day(75), managerId: id('rayne') });
  const citation = sops.createSop(db, owner, {
    title: 'Local Citation Clean-up', service: 'SEO', status: 'approved', requiresQa: true,
    purpose: 'Make a business name, address and phone number match on every directory.',
    whenToUse: 'A new local SEO client, or after a move or rebrand.',
    inputs: 'The correct business details, access to the main directories',
    steps: ['Export the current listings from the citation tool', 'Mark every listing that does not match', 'Fix or claim each mismatched listing', 'Remove duplicates', 'Record the changes in the client sheet'],
    checklist: ['Name, address and phone match everywhere', 'Duplicates removed', 'Changes recorded in the client sheet'],
    expectedOutput: 'A clean citation list with a change log',
    commonMistakes: 'Using a tracking number on some listings and the main number on others',
  });
  sops.addVersion(db, owner, citation.id, { steps: ['Export the current listings from the citation tool', 'Mark every listing that does not match', 'Fix or claim each mismatched listing', 'Remove duplicates', 'Check the top 10 directories by hand', 'Record the changes in the client sheet'], changeNote: 'Added a manual check of the top directories' });
  sops.createSop(db, owner, { title: 'Monthly SEO Report', service: 'SEO', status: 'testing', steps: ['Pull rankings', 'Pull traffic', 'Write the summary'], checklist: ['Numbers match the source'], requiresQa: true });
  sops.createSop(db, owner, { title: 'Onboarding call', service: 'Account management', status: 'draft', steps: ['Introductions'] });
  const T = (project, title, extra) => tasks.createTask(db, owner, { projectId: project.id, title, ...extra });
  T(site, 'Homepage copy', { assigneeId: id('cole'), priority: 'high', status: 'in_progress', dueDate: day(2), estimateHours: 6, description: 'Draft copy for the home, services and about pages.' });
  T(site, 'Booking form wireframe', { assigneeId: id('mark'), priority: 'urgent', dueDate: day(-2), estimateHours: 8 });
  T(site, 'Sitemap and navigation', { assigneeId: id('mark'), status: 'done', dueDate: day(-7), estimateHours: 3 });
  T(site, 'Photo shoot schedule', { assigneeId: id('rayne'), dueDate: day(5), estimateHours: 2 });
  T(seo, 'Claim Google Business Profile', { assigneeId: id('sarah'), status: 'review', sopId: citation.id, dueDate: day(1), estimateHours: 2 });
  T(seo, 'Citation clean-up', { assigneeId: id('sarah'), sopId: citation.id, dueDate: day(10), estimateHours: 14, priority: 'high' });
  T(seo, 'Keyword research', { assigneeId: id('sarah'), dueDate: day(-1), estimateHours: 6 });
  T(seo, 'Monthly report template', { priority: 'low' });
  T(shop, 'Product list from client', { assigneeId: id('rayne'), dueDate: day(8), estimateHours: 2 });
  T(shop, 'Payment provider options', { assigneeId: id('mark'), dueDate: day(12), estimateHours: 5 });
  console.log(`Demo agency ready in ${dir}. Sign in as josh, rayne, mark, sarah or cole. The demo password is in scripts/seed-demo.js.`);
})();
