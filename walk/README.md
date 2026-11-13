# The walks

Browser tests ("walks") that drive the parlor against the live OnlyWorlds server, using test accounts the OnlyWorlds team keeps (named `crew-walk-…`; their logins live in a file outside this repository, named by `CREW_WALK_ACCOUNTS`, and are never printed). Without those accounts you cannot run them; `npm test` is the check. The notes below are for the team.

```bash
export CREW_WALK_ACCOUNTS=<the accounts file>
export WALK_STATE=<a file outside the repo>
node walk/seed.mjs crew-walk-b     # the test world, its charter, fresh invite links (deletes nothing)
node walk/serve.mjs dist 30338     # the built app under its own _headers
PARLOR_URL=http://localhost:30338/ node walk/walk.mjs chromium   # a host, a member, a reader without a PIN
PARLOR_URL=http://localhost:30338/ node walk/walk.mjs firefox
node walk/teardown.mjs             # takes back only what the state recorded, and reads it back
```

The test world is "Parlor ground (crew test)"; each walk starts a new sitting, its clean slate. The walk plants decoys (a world's own elements in the room's words, without the room mark) and checks they never show as the room. Every key, token and decoy it makes is recorded in `WALK_STATE`, and teardown touches nothing else. A control: point `PARLOR_URL` at an older build.

Sign in with OnlyWorlds has two walks of its own:

- `node walk/signin-oauth.mjs [chromium|firefox]` plays the OnlyWorlds server and serves `https://parlor.onlyworlds.com` from `dist/` under its `_headers` and `_redirects`. No account needed; `DIST=<dir>` runs it on another build as a control.
- `node walk/live-signin-ow.mjs <out-prefix> [engine] [account]` uses the real server and a test account signed in on onlyworlds.com, against `DIST` when set, else the live site (`ROOM=1` comes back into a room). It revokes the token and key the parlor made, by their ids, and a run that throws or rejects still revokes every Parlor token new since its start (`FAIL_AFTER_KEPT=1` forces that failure, to check it).

Work by role has its own walk: `node walk/roles.mjs [chromium|firefox]` after the seed, against `PARLOR_URL`. It makes two Titles (one held by the host), a Character and five work items with the room mark, each recorded so `teardown.mjs` deletes them by id, and reads the Work tab's three groups (for you, for others, addressed to no one). `EXPECT_OLD=1` runs it as the control on a build without the key, where it must fail.

Files on a line have their own walk: `node walk/files.mjs [chromium|firefox]` after the seed, against `PARLOR_URL`. The host attaches a picture and a note, a .gif is refused at the pick, text named .png is refused by OnlyWorlds, a line of files alone has no text, the member sees the files and previews with no Remove, and the host removes one. Every line it makes is recorded so `teardown.mjs` deletes it by id (OnlyWorlds removes a deleted line's files with it). The paste checks run in Chromium only: Firefox's synthetic paste carries no files. `EXPECT_OLD=1` runs it as the control on a build without files, where it must fail.

Reports have their own walk: `node walk/report.mjs [chromium|firefox]` after the seed, against `PARLOR_URL`. A member hands in a free report with a file (Enter makes new lines; files alone are refused as a report), which hangs on the newest sitting by `events` and says so in the room, then a report on a work item that answers it (Ctrl+Enter); the walk reads each element back field by field, unfolds a story and checks it stays open across a redraw, has the host complete the first report in the room (a change to the report after the card opened is refused first, the typed text kept), reads the completed layout on both pages, completes the second (the work item it answers set done, its story and links kept), and measures the composer at 360 px. Then the host's own report: a member sees no keeper part; the host hands in on a second work item with the box ticked, is refused with no short part, then hands in with In short, two lines of What changed and a picked Character, and the walk reads one report born `completed` (its description, its consequences with the line that set the item done, its links) and the item `done`; a second keeper report with nothing under What changed reads `nothing changed`. The work items, the Character and every report are recorded so `teardown.mjs` deletes them by id. `EXPECT_OLD=1` runs it as the control on a build without reports, where it must fail.

The room's charter has its own walk: `node walk/charter.mjs [chromium|firefox]` after the seed, against `PARLOR_URL`. It takes the charter profile's mark off the test world's House rules by API, reads that neither page shows it as house rules and only the host is offered to mark it, presses Mark, and reads both pages and the server; whatever happens, it puts the mark back on that Law and reads it back. `EXPECT_OLD=1` is the control on a build that shows an unmarked Charter, where it must fail.

What a guest is served has its own probe, with no app in between: `node --experimental-strip-types walk/guest.mjs` after the seed. The host makes a sitting, a line, a spec, a vote and a board entry in the parlor's own shapes and reads them back; crew-walk-a, lowered from contributor to guest by the owner for the read, reads each by id and by list with a read key (the parlor's way in for a guest), and its role is put back and read back. Everything it makes is recorded for `teardown.mjs`. On 2026-11-11 a guest was served the line (a Message) and none of the sitting, spec, vote or board entry.

A watcher's room has its own walk: `node --experimental-strip-types walk/watcher.mjs [chromium|firefox]` after the seed, against `PARLOR_URL`. The host starts two sittings with a line each; crew-walk-a, lowered to guest for the walk and put back after, opens the room and must see the newer sitting's line, not the older one's, and the line saying what a watcher is not shown. `EXPECT_OLD=1` is the control on a build from before the grouping, where it must fail.

A line written by the toolkit's workshop recipe has its own walk: `node --experimental-strip-types walk/recipe.mjs [chromium|firefox]` after the seed, against `PARLOR_URL`. crew-walk-a, a contributor, writes one line exactly as the recipe says (its words in `story`, `x_room_of` the sitting's id) beside a line in the old shape (words in `description`); the host's room must show both lines' words, and crew-walk-a, lowered to guest for one read and put back, finds the line in the current sitting by its mark. `EXPECT_OLD=1` is the control on a build that reads a line's words from `description` only.
