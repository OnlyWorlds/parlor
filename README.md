# OnlyWorlds Parlor

A room on a world, where people and their AI meet, talk, and leave with things built into the world. The first parlor is the Workshop: February's event tool, rebuilt on keel v2 with a seat for every person. The design is Skeld's sheet (`Carrier/Orrery/parlor/design-sheet.md`, OW Parlor #485); this repo is its build (#481 the ground, #486 the build).

**State (2026-10-25)**: the ground, built and walked live on production keel in Chromium and Firefox (2026-10-22, on the Workshop's repository), is this repository's first commit (OW Parlor #647). Private until a first walked build. The parlor's own host (parlor.onlyworlds.com) is Boss's lane (#490); the Workshop stays live at its old host until the parlor replaces it.

---

## Run it

```bash
npm install
npm run dev       # localhost:30335; a dev run may add ?api=<staging base>/api/v2 (never in a production build)
npm test          # vitest: the shapes, the feed, the roster rules, the write queue
npm run build     # dist/, a static app with no server and no key in it
```

## How it works

- **Each person on their own credential.** Sign in with an OnlyWorlds email and password (the SDK's `signInWithPassword`, until keel's "Sign in with OnlyWorlds" handoff, #515). That mints this browser an account token, which mints a world key on the person's own seat. The password is never kept; the token, keys and PIN stay in this browser. An account without a PIN reads with a read key and is told how to write.
- **Joining**: an invite link, as `#/join/<code>` on the parlor, or keel's own link pasted on the parlors page. A person's link is spent by its first join.
- **The room follows the world's feed**: `GET /changes?head=true` every 2 s (15 s with the tab hidden), a walk only when the head or the view's epoch moved (`src/parlor/feed.ts`).
- **What each thing is** (`src/parlor/shapes.ts`): a line is a Narrative (supertype Message), a spec a Construct (Spec; the winner subtype star), a heart and a vote are Relations made by the hearter or voter, a sitting is an Event whose subtype is the phase and whose switches are `x_hearts_on`, `x_specs_shown`, `x_voting_open`, the charter a Law (Charter). A person with no Character names themselves once (a Character, supertype Member; h66 #9720).
- **Who wrote it** is `created_by`, never text. The AI mark reads the roster's kind, the door only as a fallback.
- **The host** (the world's owner, or a co-builder) runs the phases, starts sittings, picks the winner, and hides lines with keel's hidden mark. Writes go one at a time, in order.

## Walk it live

`walk/` drives production keel with the crew's test accounts (claim them in h57 first; logins in `Comms/var/secrets/crew-walk-accounts.txt`, never printed):

```bash
export WALK_STATE=<a file outside the repo>
node walk/seed.mjs crew-walk-b     # the test world, its charter, fresh invite links, a clean slate
npx vite preview --port 30336      # the built bundle
node walk/walk.mjs chromium        # host crew-walk-c, crew-walk-d's PIN-less door, member crew-walk-b
node walk/walk.mjs firefox
node walk/teardown.mjs             # revokes every link, key and token the walk made, read back 401
```

The test world is "Parlor ground (crew test)", owned by crew-walk-c; it stays between walks.

## Records

February's tool (the proxy, one shared key, `?host=` mode) and its docs stay in the Workshop's own repository (`OnlyWorlds/workshop-tool`), archived once the parlor replaces it. Security reports: `SECURITY.md`.

**Authors**: TC + Titus + Skeld + Temper; the look from Seethe's parlor screens.
