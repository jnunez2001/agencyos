// Joshua Nunez
import { h, icon, openSheet } from '../dom.js';
import { api } from '../api.js';
import { avatar, rolePill, field, selectField, toggleSwitch, tempPassword, sheetForm, confirmButton, ROLE_LABEL, DAY_LABEL } from '../ui.js';

export function openAddMember(session, onChanged) {
  openSheet('Add a team member', (close) => {
    const name = field('Name', { name: 'displayName', maxlength: 60, required: true });
    const user = field('Username', { name: 'username', required: true, autocapitalize: 'none' });
    const role = selectField('Role', session.assignableRoles.map((r) => [r, ROLE_LABEL[r]]), session.assignableRoles.includes('employee') ? 'employee' : session.assignableRoles[0], { name: 'role' });
    const google = field('Google email (optional)', { name: 'googleEmail', type: 'email', maxlength: 200, autocapitalize: 'none', placeholder: 'name@gmail.com' });
    const pass = field('Temporary password', { name: 'password', value: tempPassword() });
    const regen = h('button', { class: 'btn-text', type: 'button', onclick: () => { pass.input.value = tempPassword(); } }, 'Make another');
    return sheetForm([name, user, role, google, pass], 'Add member', async () => {
      await api('POST', '/members', { displayName: name.input.value, username: user.input.value, role: role.input.value, password: pass.input.value || undefined, googleEmail: google.input.value.trim() || undefined });
      await onChanged();
    }, close, h('div', { class: 'row-between' }, h('span', { class: 'muted' }, 'Empty password with a Google email means Google only.'), regen));
  });
}

async function openMember(session, member, onChanged) {
  const profile = await api('GET', `/members/${member.id}/profile`);
  openSheet(member.displayName, (close) => {
    const head = h('div', { class: 'member-head' }, avatar(member, 'lg'),
      h('div', {}, h('strong', {}, member.displayName), h('div', { class: 'muted' }, `@${member.username}`), h('div', {}, rolePill(member.role), member.isActive ? null : h('span', { class: 'pill off' }, 'Inactive'))));
    const facts = h('dl', { class: 'facts' },
      h('dt', {}, 'Job title'), h('dd', {}, profile.jobTitle || 'Not set'),
      h('dt', {}, 'Department'), h('dd', {}, profile.department || 'Not set'),
      h('dt', {}, 'Works'), h('dd', {}, `${profile.workDays.map((d) => DAY_LABEL[d - 1]).join(', ')}, ${profile.workStart} to ${profile.workEnd}`),
      h('dt', {}, 'Weekly capacity'), h('dd', {}, `${profile.weeklyCapacityHours} hours`),
      h('dt', {}, 'Timezone'), h('dd', {}, profile.timezone));
    if (!member.canManage) return h('div', { class: 'sheet-body' }, head, facts, h('div', { class: 'sheet-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Close')));

    const name = field('Name', { name: 'displayName', maxlength: 60, value: member.displayName });
    const roles = session.assignableRoles.includes(member.role) ? session.assignableRoles : [member.role, ...session.assignableRoles];
    const role = selectField('Role', roles.map((r) => [r, ROLE_LABEL[r]]), member.role, { name: 'role' });
    const active = { value: member.isActive };
    const self = member.id === session.user.id;
    const activeRow = self ? null : h('div', { class: 'row-between' }, h('span', {}, 'Active'), toggleSwitch(member.isActive, (on) => { active.value = on; }, 'Active'));
    const reset = h('button', { class: 'btn', type: 'button', onclick: () => { close(); openResetPassword(member, onChanged); } }, icon('key'), 'Reset password');
    // Google sign-in for this person: invite an email, clear it, or turn off their password.
    const gError = h('p', { class: 'error', role: 'alert' });
    const gEmail = field('Google email', { name: 'invite', type: 'email', maxlength: 200, autocapitalize: 'none', value: member.google && !member.google.linked && member.google.email ? member.google.email : '', disabled: !!(member.google && member.google.linked) });
    const gAct = (fn) => async () => { gError.textContent = ''; try { await fn(); await onChanged(); close(); } catch (err) { gError.textContent = err.message; } };
    const googleSection = member.google ? h('div', { class: 'stack' },
      h('p', { class: 'label' }, 'Google sign-in'),
      member.google.linked ? h('p', {}, `Linked: ${member.google.email}${member.passwordLogin ? '' : ' (password sign-in is off)'}`) : gEmail.el,
      h('div', { class: 'sheet-actions left' },
        !member.google.linked ? h('button', { class: 'btn', type: 'button', onclick: gAct(() => api('PUT', `/members/${member.id}/google`, { email: gEmail.input.value.trim() || null })) }, member.google.pending ? 'Save invitation' : 'Invite by Google email') : null,
        member.google.linked && member.passwordLogin ? confirmButton('Turn off password sign-in', 'Click again to turn off', gAct(() => api('POST', `/members/${member.id}/password-login`, { enabled: false }))) : null),
      gError) : null;
    return sheetForm([name, role], 'Save', async () => {
      const patch = { displayName: name.input.value, role: role.input.value };
      if (!self) patch.isActive = active.value;
      await api('PATCH', `/members/${member.id}`, patch);
      await onChanged();
    }, close, h('div', {}, head, facts, googleSection, activeRow, reset));
  });
}

function openResetPassword(member, onChanged) {
  openSheet(`Reset password for ${member.displayName}`, (close) => {
    const pass = field('New temporary password', { name: 'password', required: true, value: tempPassword() });
    return sheetForm([pass], 'Reset password', async () => {
      await api('POST', `/members/${member.id}/reset-password`, { password: pass.input.value });
      await onChanged();
    }, close, h('p', { class: 'muted' }, 'They are signed out and must choose a new password at their next sign-in.'));
  });
}

export async function teamView(session, { rerender }) {
  const list = await api('GET', '/members');
  const row = (m) => h('button', { class: 'row', type: 'button', onclick: () => openMember(session, m, rerender).catch((e) => alert(e.message)) },
    avatar(m, 'md'),
    h('div', { class: 'grow' }, h('div', { class: 'row-title' }, m.displayName, m.isActive ? null : h('span', { class: 'pill off' }, 'Inactive')),
      h('div', { class: 'row-sub' }, [`@${m.username}`, m.jobTitle].filter(Boolean).join(' · '))),
    rolePill(m.role), icon('chevron'));
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'Team'),
      session.can['members.create'] && h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openAddMember(session, rerender) }, icon('plus'), 'Add member')),
    h('section', { class: 'panel list' }, list.map(row)));
}
