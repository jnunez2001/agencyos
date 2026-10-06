# Roadmap step 13: AI meeting intelligence

Joshua Nunez. The AI is the one the person already connected (claude.ai, ChatGPT, Claude Code). AgencyOS gives it the material and the safe tools; it does not run a model itself, so it costs nothing extra.

## Flow
1. A person pastes the transcript (or rough notes) on the meeting note and presses "Copy AI prompt".
2. They paste the prompt into their connected AI. The AI calls `get_meeting_brief` (transcript, event, the client's open requests, open follow-ups and recent decisions), then writes the summary, decisions, requests and follow-ups with `update_meeting_note`, and can call `create_records_from_note`.
3. With an ask-first key those writes wait in the AI inbox. A person approves them. Notes the AI wrote carry an "AI draft" mark until a person edits or finalizes them.

## Safety (unchanged and tested)
The AI cannot finalize a note, approve, reject, start or convert a request, delete anything, or send anything to a client.

## Data (migration 019)
`meeting_notes.transcript` (up to 100,000 characters, left out of lists) and `ai_drafted`.
