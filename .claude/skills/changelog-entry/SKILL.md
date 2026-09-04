---
name: changelog-entry
description: Write, review or trim CHANGELOG.md entries so a reader understands them. Use when a pull request needs a changelog line, when an Unreleased section is too long or too technical to read, when deciding if a change is breaking, or when a changelog conflict appears while rebasing.
---

# Changelog entry

A changelog is written for the person who upgrades. How the change was made, what it cost, and which
files moved belong in the issue and the pull request.

## The shape of an entry

```
- [**Breaking:** ]<present-tense verb> <what the user gets> ([#<issue>])
```

```markdown
### Changed

- **Breaking:** drop `file` from `get_apex_log_summary` in favour of the scalar `topMethodsSelfPercentage` ([#86])
- Reduce every tool response with no fact lost: `execute_anonymous` by 30%, `get_apex_log_summary` by 27% ([#86])

<!-- Unreleased -->

[#86]: https://github.com/owner/repo/issues/86
```

- **One sentence, no sub-bullets.** No semicolon joining two facts. Two wrapped lines is the ceiling.
- **Present tense.** "Add", "Reduce", "Refuse" — not "Added", "Reduced".
- **Breaking entries first** in their section, prefixed `**Breaking:**`.
- **Then most impactful first.** The entry that changes the most readers' day leads its
  section. Not commit order, not issue number, not the order you wrote them.
- **Sections in this order:** Changed, Added, Removed, Fixed.
- **A reference link on every substantial entry**, defined under `<!-- Unreleased -->` at the end of
  the file. Never an inline URL.

**The file outranks this skill on style.** Read the released sections first. If they carry an emoji
and a bold label, or past tense, match them — a changelog that switches voice mid-file reads worse
than one in the wrong voice. Length and jargon are not style: those rules hold everywhere.

## Write for the reader, not the author

The reader upgrades the package; they did not write it. Name the outcome they can see.

- **No internal jargon.** No module, class, library or algorithm names. If the reader cannot find
  the word in the product, cut it.
- **A fix names the symptom, not the cause.**
- **A big feature gets one headline entry**, not a tour of every facet. Detail belongs in the docs.

## What earns an entry

One entry per user-visible change, not one per commit. If a user of the released package cannot see
it, it gets no entry: a refactor, a renamed internal helper, a test, the mechanism behind a fix.

Give the result, not the method. A number earns its place when the size **is** the result; how it
was measured does not.

**A performance entry always carries its number** — a multiple or a percentage, and what it is of.
"Faster" on its own is not an entry, because the reader cannot tell whether to care.

Already-unreleased work: edit the existing entry, and drop a fix for a bug that only ever existed
in it. A change nobody has received is not a change, and nobody met the bug.

No issue fits? File one, then reference it.

## Wrong, then right

| Wrong                                                                                                         | Right                                                           |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `- Removed destructiveHint from three tools, since the spec says it is meaningless when readOnlyHint is true` | no entry — the user sees no difference                          |
| `- Replaced ten per-category properties with one z.partialRecord, cutting ~844 to ~428 tokens`                | fold the result into the one user-facing entry                  |
| `- Reduced the cost by 31% ([#87](https://.../87))`                                                           | `- Reduce the cost by 31% ([#87])`, plus a reference definition |
| `- Refactor CSV parsing to process dataset arrays asynchronously`                                             | `- Fix the freeze on a large CSV export`                        |
| `- Replace webview-ui-toolkit with vscode-elements`                                                           | `- Match the host's controls more closely`                      |
| a feature with six nested sub-bullets                                                                         | one headline sentence, plus a docs link                         |
| `- Improve search performance`                                                                                | `- Search a 100MB log 10× faster`                               |
| `- Optimise the parser`                                                                                       | `- Cut parse time on a large log by 31%`                        |

## Trim a section nobody will read

Screens long, or nested three deep. Rewrite the section whole — entry-by-entry edits never merge
anything, and merging is most of the win.

1. Find the bounds: `grep -n '^## \[' CHANGELOG.md`.
2. Read the whole section before changing a word.
3. Draft the replacement in one pass. Fold every sub-bullet into its headline, or drop it.
4. Merge entries that name the same surface or the same fix. Three styling entries are one entry.
5. Drop what the reader cannot see, by the rules above.
6. Re-order each section by impact. A trimmed section in the old order still buries the lead.
7. Keep every issue reference. Losing one loses the trail to the detail you cut.
8. Splice it in, then check the references — left column is used but undefined, right is defined but
   unused:

   ```bash
   comm -3 <(grep -v '^\[#' CHANGELOG.md | grep -o '\[#[0-9]*\]' | sort -u) \
           <(grep -o '^\[#[0-9]*\]' CHANGELOG.md | sort -u)
   ```

9. Run the repo's formatter.

Report the before/after line count and every entry you merged or dropped. A cut the author disagrees
with is invisible to them otherwise.

## Versions and migration

- A version heading is added when the release is tagged, with an absolute date: `## [1.0.0] - 2026-03-20`.
  Until then everything sits under `## [Unreleased]`.
- **Major** is forced by behaviour that changes for someone who upgrades and changes nothing else.
- When upgrading needs an action, add a migration note under `## [Unreleased]` that points at it.

## Stacked branches

Every branch in a stack writes into the same `## [Unreleased]` section, so a rebase conflicts there.
Keep both sides. Losing the other branch's entry is silent, and review will not catch it.
