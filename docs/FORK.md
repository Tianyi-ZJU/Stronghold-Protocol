# Fork maintenance

Repository: <https://github.com/Tianyi-ZJU/Stronghold-Protocol>.
Upstream: <https://github.com/sganggs/Stronghold-Protocol>.
Base: `bdb0765c5579c430cbe1ef79cf3d62831bb062a7` (0.1.2).
Modification date: 2026-10-04.

The `fork-enhancements` branch contains the Hono HTTP refactor, online player
counts, five feedback fixes, and their tests. The code remains GPL-3.0-or-later;
original copyright notices and the Spine linking permission remain in place.
Hono and its Node adapter retain their MIT licences in THIRD-PARTY-NOTICES.md.

## Run this branch

```sh
git clone -b fork-enhancements https://github.com/Tianyi-ZJU/Stronghold-Protocol.git
cd Stronghold-Protocol
npm ci
npm run setup
npm start
```

Use Node 22 or 24. Setup obtains the optional game resources separately; this
branch adds no art, audio, fonts or bundled dependencies. Copyright in inherited
game data and screenshots remains with the respective owners, as NOTICE.md
describes.

The title screen and lobby display aggregate online counts. Open `/online/` for
the counts page. Visitors who have not entered a nickname, AI and disconnected
reconnect records are excluded. Refreshing the same player does not add another
player. Different browser identities are counted separately.

## Publication scope

Machine-specific `compose.yaml`, `deploy/`, raw feedback and local review files
are ignored and preserved on the server. New commits contain source, automated
tests and general documentation. LICENSE and NOTICE.md remain unchanged.
Source distribution and a game-resource bundle have different third-party
licensing requirements; this fork publishes source changes.

## Incorporate upstream updates

In a clone of this fork, add upstream once:

```sh
git remote add upstream https://github.com/sganggs/Stronghold-Protocol.git
git fetch upstream
git switch fork-enhancements
git merge upstream/master
npm ci
node --test
git push origin fork-enhancements
```

Resolve any merge conflicts and run checks before pushing. Deploying a changed
game server requires a restart; wait for active matches to finish first.

If `fork-enhancements` is merged into `master`, update the clone instructions in
README.md and this file to use the chosen default branch. The GitHub repository
setting for the default branch can also select `fork-enhancements`.
