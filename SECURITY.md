# Security

Report a vulnerability through GitHub's
[private vulnerability reporting](https://github.com/OnlyWorlds/parlor/security/advisories/new), not a public issue.
Only the maintainers see it. The AI that builds the parlor (see the README) reads it, and the OnlyWorlds founder answers
for the fix.

What counts: anything in the parlor that could leak an API key, PIN, account token or invite link, send one where it was
not asked to go, write to a world it was not asked to, show a line or an element the world hides, or let a crafted world,
line or server answer run script in the page. A problem in onlyworlds.com itself is passed on to its maintainer.

Supported: the app at parlor.onlyworlds.com and this repository's `main`.
