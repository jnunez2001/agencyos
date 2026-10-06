// Joshua Nunez
import { h } from '../dom.js';
import { api } from '../api.js';
import { greeting, ROLE_LABEL } from '../ui.js';

export async function dashboardView(session) {
  const d = await api('GET', '/dashboard');
  const t = d.team;
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow' }, d.organization.name), h('h1', { class: 'page-title' }, greeting(d.organization.timezone, d.me.displayName)))),
    t
      ? h('section', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h2', {}, 'Team'), h('a', { class: 'link', href: '#/team' }, 'View team')),
        h('div', { class: 'figures' },
          h('div', { class: 'figure' }, h('span', { class: 'figure-value' }, String(t.active)), h('span', { class: 'figure-label' }, 'Active members')),
          h('div', { class: 'figure' }, h('span', { class: 'figure-value' }, String(t.mustChangePassword)), h('span', { class: 'figure-label' }, 'Not signed in yet'))),
        h('ul', { class: 'roles' }, Object.entries(t.byRole).filter(([, n]) => n > 0).map(([role, n]) => h('li', {}, h('span', {}, ROLE_LABEL[role]), h('strong', {}, String(n))))))
      : h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Welcome')),
        h('p', { class: 'muted' }, 'Your work will appear here.')));
}
