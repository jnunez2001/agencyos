// Joshua Nunez
// The modules a person can open. Only modules that exist and that the role may use are shown.
export const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', show: () => true },
  { key: 'tasks', label: 'Tasks', icon: 'tasks', show: (s) => s.can['tasks.view'] },
  { key: 'projects', label: 'Projects', icon: 'projects', show: (s) => s.can['projects.view'] },
  { key: 'clients', label: 'Clients', icon: 'clients', show: (s) => s.can['clients.view'] },
  { key: 'team', label: 'Team', icon: 'team', show: (s) => s.can['members.list'] },
  { key: 'ai', label: 'AI', icon: 'sparkle', show: (s) => s.can['ai.manage'] },
  { key: 'activity', label: 'Activity', icon: 'activity', show: (s) => s.can['activity.view'] },
  { key: 'settings', label: 'Settings', icon: 'settings', show: (s) => s.can['org.update'] },
];

const MOBILE_SLOTS = 4;
export const visibleNav = (session) => NAV.filter((n) => n.show(session));
// On a phone the bottom bar holds the first few; the rest are reached from the Me page.
export const bottomNav = (session) => visibleNav(session).slice(0, MOBILE_SLOTS);
export const overflowNav = (session) => visibleNav(session).slice(MOBILE_SLOTS);
