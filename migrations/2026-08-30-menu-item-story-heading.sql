-- Menu-level editorial heading for public item pages. Safe to replay.
ALTER TABLE public.menu
  ADD COLUMN IF NOT EXISTS item_story_heading varchar(80) NOT NULL DEFAULT 'The backstory';
