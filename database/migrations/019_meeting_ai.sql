-- Joshua Nunez
-- AI meeting intelligence: a pasted transcript on a meeting note, and a mark on notes an AI wrote until a person reviews them.
ALTER TABLE meeting_notes ADD COLUMN transcript TEXT NOT NULL DEFAULT '' CHECK (length(transcript) <= 100000);
ALTER TABLE meeting_notes ADD COLUMN ai_drafted INTEGER NOT NULL DEFAULT 0 CHECK (ai_drafted IN (0,1));
