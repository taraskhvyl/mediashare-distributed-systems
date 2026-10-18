---
status: accepted
---

# Only Published files are sent to the AI model

The tagger sends an image's thumbnail to OpenAI. A private file is "owner and admins only"
(CONTEXT.md), so sending its pixels to a third party would break that promise. The tagger
therefore tags a file only when it is **Published** (public and ready), and checks that
at the moment it is about to call the model.

Two facts make a file Published, and they arrive in either order, so both start the same
check: `file.ready` (from the processor) and `file.made_public` (new, written by the api in
the same transaction as the visibility change, through the outbox). Whichever comes second
finds the file Published and proceeds; the first one finds it not Published yet and skips.
The gate reads the file's state from Postgres, never from the event: visibility can change
between the event and the call. `tagger_user` has a column-level `SELECT (id, visibility,
status, thumbnail_key)` on `files` and nothing wider.

## Considered options

- **Tag every image, thumbnail only** (the first design). Simplest, but the thumbnails of
  private files go to a third party without anyone being asked.
- **Per-file or per-user opt-in.** The only real consent answer; needs UI and a column.
  Left as the production path (SECURITY.md).
- **A local model for private files, OpenAI for public ones.** Strongest privacy, two model
  paths to run and keep consistent.

## Consequences

- Private files get no caption, even for their owner, until published. A caption can take a
  few seconds to appear after making a file public.
- Un-publishing doesn't un-send: a thumbnail already sent stays sent, and the caption row
  stays. Files tagged before this decision were tagged under the first design.
- "Public" is not consent to a third party. A user who publishes to followers has not
  agreed to OpenAI processing the image; this narrows the exposure, it doesn't remove it.
- The model call takes seconds, so visibility can still change during it. The window is
  one call wide, and the check cannot be atomic with an external request.
- If both trigger events are waiting in the topic when the tagger starts (lag), the first
  one tags and the second calls the model again before its insert loses (ADR 0007): one
  wasted call, never a second caption.
- The definition of Published now lives in two places: `IS_PUBLISHED_SQL` in the api and
  the tagger's gate query. Each carries a comment pointing at the other.
