// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const clients = require('../server/services/clients');
const projects = require('../server/services/projects');
const events = require('../server/services/events');
const notes = require('../server/services/meetingnotes');
const { listActivity } = require('../server/services/activity');
const { fixture } = require('./fixture');

async function setup() {
  const f = await fixture();
  f.client = clients.createClient(f.db, f.mark, { name: 'Acme Dental' });
  f.project = projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'Website' });
  f.event = events.createEvent(f.db, f.mark, { title: 'Kickoff call', type: 'client_meeting', startsAt: '2026-10-12T14:00:00Z', endsAt: '2026-10-12T15:00:00Z', projectId: f.project.id, attendees: [f.ids.sarah, f.ids.cole] });
  f.zedClient = clients.createClient(f.db, f.zed, { name: 'Zed Client' });
  return f;
}

test('a note made from an event takes its title, date, client and project, and links back', async () => {
  const f = await setup();
  const n = notes.createNote(f.db, f.mark, { eventId: f.event.id, summary: 'Good call', decisions: 'Use WordPress' });
  assert.deepEqual([n.title, n.meetingDate, n.clientName, n.projectName, n.status, n.eventId], ['Kickoff call', '2026-10-12', 'Acme Dental', 'Website', 'draft', f.event.id]);
  assert.equal(events.getEvent(f.db, f.mark, f.event.id).meetingNoteId, n.id);
  assert.throws(() => notes.createNote(f.db, f.mark, { eventId: f.event.id }), /already has meeting notes/);
});

test('a standalone note needs a title and a date, and its links must agree', async () => {
  const f = await setup();
  assert.throws(() => notes.createNote(f.db, f.mark, { title: 'Call' }), /Meeting date/);
  const c2 = clients.createClient(f.db, f.mark, { name: 'Second' });
  assert.throws(() => notes.createNote(f.db, f.mark, { title: 'Call', meetingDate: '2026-10-01', projectId: f.project.id, clientId: c2.id }), /another client/);
  assert.throws(() => notes.createNote(f.db, f.mark, { title: 'Call', meetingDate: '2026-10-01', clientId: f.zedClient.id }), /not found/i);
  const n = notes.createNote(f.db, f.mark, { title: 'Call', meetingDate: '2026-10-01', projectId: f.project.id });
  assert.equal(n.clientId, f.client.id);
});

test('who may write: managers any, attendees their own draft, nobody else', async () => {
  const f = await setup();
  assert.throws(() => notes.createNote(f.db, f.sarah, { title: 'x', meetingDate: '2026-10-01' }), /not allowed/i);
  const n = notes.createNote(f.db, f.sarah, { eventId: f.event.id, discussion: 'We talked' });
  assert.equal(n.canEdit, true);
  assert.equal(n.canFinalize, false);
  assert.equal(notes.updateNote(f.db, f.cole, n.id, { summary: 'By an attendee' }).summary, 'By an attendee');
  const other = notes.createNote(f.db, f.mark, { title: 'Private', meetingDate: '2026-10-02' });
  assert.throws(() => notes.updateNote(f.db, f.sarah, other.id, { summary: 'x' }), /not allowed/i);
  assert.throws(() => notes.createNote(f.db, f.sarah, { eventId: events.createEvent(f.db, f.mark, { title: 'Closed', startsAt: '2026-10-13T09:00:00Z' }).id }), /not found|not allowed/i);
});

test('only a manager finalizes; a final note is locked until reopened', async () => {
  const f = await setup();
  const n = notes.createNote(f.db, f.sarah, { eventId: f.event.id });
  assert.throws(() => notes.updateNote(f.db, f.sarah, n.id, { status: 'final' }), /manager/i);
  const fin = notes.updateNote(f.db, f.mark, n.id, { status: 'final' });
  assert.deepEqual([fin.status, fin.finalizedByName], ['final', 'Mark']);
  assert.ok(fin.finalizedAt);
  assert.throws(() => notes.updateNote(f.db, f.sarah, n.id, { summary: 'late edit' }), /final/i);
  assert.equal(notes.getNote(f.db, f.sarah, n.id).canEdit, false);
  assert.equal(notes.updateNote(f.db, f.mark, n.id, { summary: 'fixed typo' }).summary, 'fixed typo');
  const reopened = notes.updateNote(f.db, f.mark, n.id, { status: 'draft' });
  assert.deepEqual([reopened.status, reopened.finalizedAt], ['draft', null]);
  assert.throws(() => notes.createNote(f.db, f.sarah, { eventId: events.createEvent(f.db, f.mark, { title: 'T', startsAt: '2026-10-14T09:00:00Z', attendees: [f.ids.sarah] }).id, status: 'final' }), /manager/i);
});

test('a Contractor sees only notes they wrote or of events they attend', async () => {
  const f = await setup();
  const mine = notes.createNote(f.db, f.mark, { eventId: f.event.id });
  const hidden = notes.createNote(f.db, f.mark, { title: 'Internal', meetingDate: '2026-10-02', clientId: f.client.id });
  assert.deepEqual(notes.listNotes(f.db, f.cole).map((n) => n.id), [mine.id]);
  assert.equal(notes.getNote(f.db, f.cole, mine.id).clientName, null);
  assert.throws(() => notes.getNote(f.db, f.cole, hidden.id), /not found/i);
  assert.equal(notes.listNotes(f.db, f.sarah).length, 2);
});

test('the list filters and leaves out the long sections', async () => {
  const f = await setup();
  notes.createNote(f.db, f.mark, { eventId: f.event.id, summary: 'Pricing agreed', discussion: 'long text' });
  notes.createNote(f.db, f.mark, { title: 'Internal sync', meetingDate: '2026-09-01', status: 'final' });
  const all = notes.listNotes(f.db, f.mark);
  assert.deepEqual(all.map((n) => n.title), ['Kickoff call', 'Internal sync']);
  assert.equal(all[0].discussion, undefined);
  assert.deepEqual(notes.listNotes(f.db, f.mark, { status: 'final' }).map((n) => n.title), ['Internal sync']);
  assert.deepEqual(notes.listNotes(f.db, f.mark, { clientId: f.client.id }).map((n) => n.title), ['Kickoff call']);
  assert.deepEqual(notes.listNotes(f.db, f.mark, { q: 'pricing' }).map((n) => n.title), ['Kickoff call']);
  assert.deepEqual(notes.listNotes(f.db, f.mark, { from: '2026-10-01' }).map((n) => n.title), ['Kickoff call']);
  assert.equal(notes.listNotes(f.db, f.mark, { q: '%' }).length, 0);
});

test('delete is a manager action, unlinks the event, and agencies are isolated', async () => {
  const f = await setup();
  const n = notes.createNote(f.db, f.mark, { eventId: f.event.id });
  assert.throws(() => notes.deleteNote(f.db, f.sarah, n.id), /not allowed/i);
  assert.throws(() => notes.getNote(f.db, f.zed, n.id), /not found/i);
  assert.throws(() => notes.updateNote(f.db, f.zed, n.id, { title: 'x' }), /not found/i);
  assert.throws(() => notes.deleteNote(f.db, f.zed, n.id), /not found/i);
  assert.equal(notes.listNotes(f.db, f.zed).length, 0);
  notes.deleteNote(f.db, f.mark, n.id);
  assert.equal(events.getEvent(f.db, f.mark, f.event.id).meetingNoteId, null);
  assert.equal(notes.createNote(f.db, f.mark, { eventId: f.event.id }).eventId, f.event.id);
});

test('changes are logged; long sections only by name', async () => {
  const f = await setup();
  const n = notes.createNote(f.db, f.mark, { eventId: f.event.id });
  notes.updateNote(f.db, f.mark, n.id, { discussion: 'secret client detail', title: 'Kickoff' });
  notes.updateNote(f.db, f.mark, n.id, { status: 'final' });
  const rows = listActivity(f.db, f.josh).filter((a) => a.objectType === 'meeting_note').reverse();
  assert.deepEqual(rows.map((a) => a.action), ['meeting_note.create', 'meeting_note.update', 'meeting_note.finalize']);
  assert.deepEqual(rows[1].after, { title: 'Kickoff', discussion: '(changed)' });
});

test('a transcript is kept, left out of lists, and AI-written notes are marked until a person reviews them', async () => {
  const f = await setup();
  const ai = { ...f.mark, source: 'ai' };
  const n = notes.createNote(f.db, ai, { title: 'Call', meetingDate: '2026-10-12', clientId: f.client.id, transcript: 'Dr. Lee: we need booking.', summary: 'Booking wanted' });
  assert.deepEqual([n.transcript, n.aiDrafted], ['Dr. Lee: we need booking.', true]);
  assert.equal(notes.listNotes(f.db, f.mark)[0].transcript, undefined);
  assert.equal(notes.updateNote(f.db, f.mark, n.id, { status: 'draft' }).aiDrafted, true, 'no change, still marked');
  assert.equal(notes.updateNote(f.db, f.mark, n.id, { summary: 'Edited by a person' }).aiDrafted, false);
  assert.equal(notes.updateNote(f.db, ai, n.id, { decisions: '- Use WordPress' }).aiDrafted, true);
  assert.equal(notes.updateNote(f.db, f.mark, n.id, { status: 'final' }).aiDrafted, false, 'finalizing is the review');
  assert.throws(() => notes.updateNote(f.db, f.mark, n.id, { transcript: 'x'.repeat(100001) }), /Transcript must be/);
});
