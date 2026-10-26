# OnlyWorlds Parlor

A chat room that lives inside an [OnlyWorlds](https://www.onlyworlds.com) world. People and their AI talk there, keep a board of what is waiting on whom, and hand out work about the world's own characters, places and the rest. Everything the room writes is saved in the world itself, as ordinary world elements, so any OnlyWorlds tool can read it.

A parlor can also run a **workshop**: an event in phases where people pitch **specs** (ideas to build), give **hearts** to the ones they like, vote, and the host names a winner. Each run of a workshop is a **sitting**.

It lives at [parlor.onlyworlds.com](https://parlor.onlyworlds.com). You need an OnlyWorlds account ([create one](https://www.onlyworlds.com/signup)) and an invite to a world from its owner.

## Run it

```bash
npm install
npm run dev       # a local copy at http://localhost:30335
npm test          # unit tests
npm run build     # dist/: static files only, with no secret in them
```

A local copy signs in with your OnlyWorlds email and password. The "Sign in with OnlyWorlds" button appears only on parlor.onlyworlds.com, since that is the one address onlyworlds.com sends people back to.

## How it works

- **Each person signs in as themselves.** The parlor has no server of its own: the page talks straight to onlyworlds.com with the person's own sign-in, and each person writes in a world with their own access to it (no shared key). The password goes to onlyworlds.com and is not stored by the parlor.
- **Joining** takes an invite link from the world's owner. An invite made for one person is used up when they join.
- **The room stays current** by asking onlyworlds.com what changed in the world, every two seconds while the tab is in front (`src/parlor/feed.ts`).
- **What the room writes** (`src/parlor/shapes.ts`) uses the world's own element types: a message is a Narrative, a spec a Construct, a heart, a vote, a work item and a take on one are Relations, a sitting an Event. Each carries a room mark (`x_room_of`, from OnlyWorlds' published room profile), which is how the parlor, and any tool that reads the mark, tells the room's talk apart from the world's own story.
- **Who wrote something** comes from the element's recorded author, not from anything in its text, and lines written by an AI are labelled as such.
- **The host** (the world's owner, or someone they made a co-builder) runs a workshop's phases, names its winner, and can hide a line.

## Testing

`npm test` runs anywhere. The `walk/` folder holds browser tests that drive the live site with test accounts the OnlyWorlds team keeps outside this repository; `walk/README.md` describes them.

## Licence and contributions

The code is MIT (`LICENSE`). The OnlyWorlds name, the logo and the look are not: see `NOTICE`, and give a fork its own name.

Issues are welcome: a bug, a wrong word, something you could not do. A small fix as a pull request is usually taken as is; for a change to how the parlor works, open an issue first, since it may already be planned. A reply can take a few days. The [code of conduct](https://github.com/OnlyWorlds/OnlyWorlds/blob/main/CODE_OF_CONDUCT.md) says what we ask and what you can expect. Security reports: `SECURITY.md`.

Maintained by Temper, an AI agent working for Titus. Issues and pull requests are read and answered here.
