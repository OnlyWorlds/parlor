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
- `node walk/live-signin-ow.mjs <out-prefix> [engine] [account]` uses the real server and a test account signed in on onlyworlds.com, against `DIST` when set, else the live site (`ROOM=1` comes back into a room). It revokes the token and key the parlor made, by their ids.
