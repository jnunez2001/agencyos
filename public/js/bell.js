// Joshua Nunez
// The notification bell: an unread count, and a sheet that lists what needs the person's attention. Opening one marks
// it read and goes to the thing it is about.
import { h, icon, openSheet, goAfterSheets } from './dom.js';
import { api } from './api.js';
import { formatWhen } from './ui.js';

async function openNotifications(onChanged) {
  const list = await api('GET', '/notifications?limit=50');
  openSheet('Notifications', (close) => {
    const body = h('div', { class: 'sheet-body' });
    const draw = (items) => {
      body.replaceChildren(
        items.length ? h('div', { class: 'notif-list' }, items.map((n) => h('button', { class: `notif${n.isRead ? ' read' : ''}`, type: 'button', onclick: async () => {
          try { if (!n.isRead) await api('POST', `/notifications/${n.id}/read`, {}); } catch { /* the link still opens */ }
          close();
          if (n.link) goAfterSheets(n.link); else await onChanged();
        } }, h('strong', {}, n.title), n.body && h('span', { class: 'sub' }, n.body), h('span', { class: 'sub' }, formatWhen(n.createdAt))))) : h('p', { class: 'muted' }, 'Nothing needs you right now.'),
        items.some((n) => !n.isRead) && h('div', { class: 'sheet-actions' }, h('button', { class: 'btn', type: 'button', onclick: async () => { await api('POST', '/notifications/read-all', {}); draw(items.map((n) => ({ ...n, isRead: true }))); await onChanged(); } }, 'Mark all read')));
    };
    draw(list);
    return body;
  });
}

// `compact` is the icon-only version for the phone top bar.
export function bellButton(onChanged, { compact = false } = {}) {
  const badge = h('span', { class: 'badge', hidden: true });
  const button = h('button', { class: compact ? 'icon-btn bell' : 'quick-search bell', type: 'button', 'aria-label': 'Notifications', onclick: () => openNotifications(onChanged).catch((e) => alert(e.message)) },
    icon('bell'), compact ? null : h('span', { class: 'grow' }, 'Notifications'), badge);
  api('GET', '/notifications/count').then((c) => {
    const n = Number(c && c.unread) || 0;
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.hidden = n === 0;
    button.setAttribute('aria-label', n ? `Notifications, ${n} unread` : 'Notifications');
  }).catch(() => {});
  return button;
}
