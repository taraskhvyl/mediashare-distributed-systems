---
status: accepted
---

# The first AI caption for a file is kept; a redelivery never replaces it

Captions and tags come from a language model, so asking twice gives two different answers,
while Kafka delivery is at-least-once: the same `file.ready` event can reach the tagger
twice. If the second answer overwrote the first, a caption would change under a reader for
no reason, and one event would pay for two model calls whose results disagree.

Decision: the tagger writes to its own table, `file_ai_metadata(file_id PK, caption, tags,
model, created_at)`, with `INSERT … ON CONFLICT DO NOTHING`. The primary key enforces
"first write wins" in the schema, not in application code. The `tagger_user` role gets
`INSERT` on that table and nothing on `files`, so a bug in the tagger can't corrupt a File.
"Untagged" is the absence of a row.

## Considered options

- **Columns on `files`** (`caption`, `tags`), column-scoped `GRANT UPDATE`. No join, but
  re-tagging overwrites unless every writer remembers `WHERE caption IS NULL`, and there is
  nowhere to record which model produced the text.
- **Upsert (last write wins)** in the separate table. Allows re-tagging with a better model,
  but a retry can flip a caption between two reads.

## Consequences

- A redelivery still costs one model call before the insert is skipped. Checking for a row
  first would save it, but is a read-then-act race between two replicas; the insert is the
  only authority.
- A bad first caption sticks. Replacing captions (a better model, a new prompt) needs an
  explicit re-tag step that deletes rows first; that is deliberately not built.
- Every read of a File that shows a caption is a LEFT JOIN.
- The tagger writes Postgres and does not publish an event (no dual write). Tags appear on
  the next load; the Live event for them is not built.
