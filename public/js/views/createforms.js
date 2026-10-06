// Joshua Nunez
// Small forms to start a client request, a follow-up or a decision from anywhere (the Create menu). They post to the
// same endpoints as the full screens and ask only for what the record needs.
import { h, openSheet } from '../dom.js';
import { api } from '../api.js';
import { field, selectField, textareaField, sheetForm } from '../ui.js';

const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const idOrNull = (value) => (value === '' ? null : Number(value));

export async function openRequestForm(session, { clientId } = {}, onSaved) {
  const clients = (await api('GET', '/clients')).filter((c) => c.status !== 'archived');
  if (!clients.length) throw new Error('Add a client first. A request always belongs to a client.');
  openSheet('New client request', (close) => {
    const title = field('Title', { name: 'title', maxlength: 200, required: true });
    const client = selectField('Client', clients.map((c) => [c.id, c.name]), clientId || clients[0].id, { name: 'clientId' });
    const requestedBy = field('Asked by', { name: 'requestedBy', maxlength: 120, placeholder: 'Who at the client asked' });
    const due = field('Due date', { name: 'dueDate', type: 'date' });
    const description = textareaField('Details', { name: 'description', maxlength: 5000 });
    return sheetForm([title, client, h('div', { class: 'two' }, requestedBy.el, due.el), description], 'Add request', async () => {
      const saved = await api('POST', '/requests', { title: title.input.value, clientId: Number(client.input.value), requestedBy: requestedBy.input.value, dueDate: due.input.value || null, description: description.input.value });
      await onSaved(saved);
    }, close);
  });
}

export async function openFollowUpForm(session, _options, onSaved) {
  const members = session.can['members.list'] ? (await api('GET', '/members')).filter((m) => m.isActive) : [];
  openSheet('New follow-up', (close) => {
    const title = field('Title', { name: 'title', maxlength: 200, required: true });
    const assignee = selectField('Assigned to', [['', 'Nobody'], ...members.map((m) => [m.id, m.displayName])], session.user.id, { name: 'assigneeId' });
    const due = field('Due date', { name: 'dueDate', type: 'date' });
    const details = textareaField('Details', { name: 'details', maxlength: 5000 });
    return sheetForm([title, h('div', { class: 'two' }, assignee.el, due.el), details], 'Add follow-up', async () => {
      const saved = await api('POST', '/follow-ups', { title: title.input.value, assigneeId: idOrNull(assignee.input.value), dueDate: due.input.value || null, details: details.input.value });
      await onSaved(saved);
    }, close);
  });
}

export async function openDecisionForm(session, _options, onSaved) {
  const clients = session.can['clients.view'] ? (await api('GET', '/clients')).filter((c) => c.status !== 'archived') : [];
  openSheet('Record a decision', (close) => {
    const title = field('Decision', { name: 'title', maxlength: 200, required: true });
    const decidedOn = field('Decided on', { name: 'decidedOn', type: 'date', required: true, value: todayKey() });
    const client = clients.length ? selectField('Client', [['', 'No client'], ...clients.map((c) => [c.id, c.name])], '', { name: 'clientId' }) : null;
    const details = textareaField('Details', { name: 'details', maxlength: 5000 });
    return sheetForm([title, decidedOn, client, details], 'Record decision', async () => {
      const saved = await api('POST', '/decisions', { title: title.input.value, decidedOn: decidedOn.input.value, clientId: client ? idOrNull(client.input.value) : null, details: details.input.value });
      await onSaved(saved);
    }, close);
  });
}
