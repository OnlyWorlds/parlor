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
