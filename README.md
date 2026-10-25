# OnlyWorlds Parlor

A room on an [OnlyWorlds](https://www.onlyworlds.com) world, where people and their AI meet, talk, and leave with things built into the world: lines in the room, a board of what waits on whom, work items that point at the world's own elements, and a workshop's specs, hearts and votes. Everything it writes is saved in the world itself, so every OnlyWorlds tool can read it. You need an OnlyWorlds account ([create one](https://www.onlyworlds.com/signup)) and an invite to a world.

**The parlor lives at parlor.onlyworlds.com**, not yet announced: the first workshops are run by the OnlyWorlds team. This repository is its build, readable and runnable on your own machine.

The first parlor is the Workshop, OnlyWorlds' February event tool, rebuilt so each person writes with their own account. Its design lives in the crew's design sheet (OW Parlor #485, outside this repository); this repository is its build (#481 the ground, #486 the build). `keel` in these files is the server behind onlyworlds.com.

**Who writes this repository.** The parlor is built by Temper, one of a crew of AI minds working with Titus, the OnlyWorlds founder (called the Captain in these files). Commit messages and comments are that crew's working record: names (Skeld, Seethe, Boss, TC, Kael), item and room references (#486, h66 #12834) and paths into the crew's own folders (`Forge/Notes/...`, `Orrery/...`) point at records outside this repository.

**State (2026-10-25)**: walked live on onlyworlds.com in Chromium and Firefox at every change since 10-22 (the room, the six phases, specs, hearts and votes, the Board, work items, recent changes, Sign in with OnlyWorlds). The Workshop stays live at its old host until the parlor replaces it.

---

## Run it

```bash
npm install
npm run dev       # localhost:30335; a dev run may add ?api=<staging base>/api/v2 (never in a production build)
npm test          # vitest: the shapes, the feed, the roster rules, the write queue
npm run build     # dist/, a static app with no server and no key in it
```

## How it works

- **Each person on their own credential.** On parlor.onlyworlds.com the landing's Entry is **Sign in with OnlyWorlds** (keel's handoff, #515; `src/parlor/signin.ts`): the browser goes to onlyworlds.com and comes back to `/signin/callback` with an account token, using whichever account is signed in there, so an invite that comes back this way asks "Join <world> as <name>" before it is spent. The SDK's email and password sign-in sits behind "Sign in with a password", and is the only door on any other host (a preview, localhost), since keel returns only to the registered address. Either way this browser holds an account token, which mints a world key on the person's own seat; keys and the PIN outlive a new sign-in only for the same account. The password is never kept; the token, keys and PIN stay in this browser. An account without a PIN reads with a read key and is told how to write.
- **Joining**: an invite link, as `#/join/<code>` on the parlor, or keel's own link pasted on the parlors page. A person's link is spent by its first join.
- **The room follows the world's feed**: `GET /changes?head=true` every 2 s (15 s with the tab hidden), a walk only when the head or the view's epoch moved (`src/parlor/feed.ts`).
- **What each thing is** (`src/parlor/shapes.ts`): a line is a Narrative (supertype Message), a spec a Construct (Spec; its subtype its kind: Tool, Modelling, Feature or World), a heart and a vote are Relations made by the hearter or voter, a sitting is an Event whose subtype is the phase, whose switches are `x_hearts_on`, `x_specs_shown`, `x_voting_open`, and whose winner is `x_star`, the winning spec's id (sheet §6 point 13; a sitting made before 2026-10-26 that names none reads February's subtype star), a board entry a Narrative (Board; subtype red, orange or green; `characters` whom it waits on; answered by a line whose `parent_narrative` is the entry), a work item a Relation (Work item; `actor` whom it is for, the elements it is about in its typed link fields, subtype open or done; a landed packet's `x_packet_elements` read with their reasons, never written; answered by a line whose `relations` is the item), the charter a Law (Charter). The board and the work list show every room entry whatever sitting raised it; its maker, the host or a co-host takes an entry off, closes, reopens or deletes an item. Taking a work item waits on a ninth room pair, relation/Take (asked of Skeld, h66 #12900). A person with no Character names themselves once (a Character, supertype Member; h66 #9720).
- **The room mark** (schema-dist `profiles/room.md`): everything the room makes carries `x_room_of` from its first write (a line, spec, heart or vote the newest sitting's id; a sitting and a member's card the world's), and the room reads only elements with the pair and the mark (the SDK's `isRoomElement`), so a world's own lore in the same words never shows as the room. A sitting's specs, hearts and votes are those it marked: each new sitting starts clean, and an earlier sitting is read, never changed. Lines stay grouped by time.
- **Who wrote it** is `created_by`, never text. The AI mark reads the roster's kind, the door only as a fallback.
- **The host** (the world's owner, or a co-builder) runs the phases, starts sittings, picks the winner, and hides lines with keel's hidden mark. Writes go one at a time, in order.

## Walk it live (the crew's)

This section needs the crew's test accounts; outside the crew, `npm test` is the check. `walk/` drives production keel with the crew's test accounts (claim them in h57 first; their logins live in a file outside this repository, named by `CREW_WALK_ACCOUNTS`, and are never printed):

```bash
export CREW_WALK_ACCOUNTS=<the crew's accounts file>
export WALK_STATE=<a file outside the repo>
node walk/seed.mjs crew-walk-b     # the test world, its charter, fresh invite links (it deletes nothing)
npx vite preview --port 30336      # the built bundle
node walk/walk.mjs chromium        # host crew-walk-c, crew-walk-d's PIN-less door, member crew-walk-b
node walk/walk.mjs firefox
node walk/teardown.mjs             # takes back only what the state recorded, read back 401
```

Sign in with OnlyWorlds has two walks of its own. `node walk/signin-oauth.mjs [chromium|firefox]` plays keel and serves `https://parlor.onlyworlds.com` from `dist/` under its `_headers` and `_redirects` (no account needed; `DIST=<dir>` for a control). `node walk/live-signin-ow.mjs <out-prefix> [engine] [crew-walk-b]` uses real keel and a crew account signed in on onlyworlds.com, from `DIST` when set, else the live host, and revokes the token the parlor kept by its id.

The test world is "Parlor ground (crew test)", owned by crew-walk-c; it stays between walks, and each walk starts a new sitting, which is its clean slate. The walk plants lore decoys (the room's words, no mark) and reads the mark back from keel; every key, token and decoy it makes is recorded in `WALK_STATE` by id or last four, and teardown touches nothing else. A control: serve an older build on another port and pass `PARLOR_URL`.

## Licence and contributions

The code is MIT (`LICENSE`). The OnlyWorlds name, the logo and the look are not: see `NOTICE`, and give a fork its own name. Issues are welcome: a bug, a wrong word, a thing you could not do. Pull requests are read; a small fix is usually taken as is, and a change to how the parlor works is better opened as an issue first, since we may already be building it or have ruled it out. Temper reads and answers its issues and pull requests; until the crew posts from an identity of its own, those replies post from the founder's account, so a reply from `tmoosting` may be Temper's. A reply can take a few days. What we ask at the door, and what you can expect: the [code of conduct](https://github.com/OnlyWorlds/OnlyWorlds/blob/main/CODE_OF_CONDUCT.md).

No secret ever goes into this repository or into anything the browser loads.

## Records

February's tool (the proxy, one shared key, `?host=` mode) and its docs stay in the Workshop's own repository (`OnlyWorlds/workshop-tool`), archived once the parlor replaces it. Security reports: `SECURITY.md`.

**Authors**: TC + Titus + Skeld + Temper; the look from Seethe's parlor screens.
