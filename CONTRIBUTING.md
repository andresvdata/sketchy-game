# Contributing to Sketchy

Thanks for helping make Sketchy better! This guide covers the most common ways to contribute, from adding a single prompt to changing the game's code.

By taking part you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

| You want to… | Do this |
|---|---|
| Add funny prompts or a new category | Edit `js/prompts.js` ([guide below](#adding-prompts)) |
| Report something broken | [Open a bug report](../../issues/new?template=bug_report.yml) |
| Suggest a feature | [Open a feature request](../../issues/new?template=feature_request.yml) |
| Propose a prompt pack without coding | [Open a prompt pack issue](../../issues/new?template=prompt_pack.yml) |
| Fix a bug or build a feature | Read [Working on the code](#working-on-the-code) |

Look for issues labelled **`good first issue`** if you want a place to start.

---

## Adding prompts

All prompts live in [`js/prompts.js`](js/prompts.js). You can edit it right in the GitHub website editor: open the file, click the pencil icon, make your change and choose **Propose changes**.

```js
"Animals":[
  "a giraffe stuck in an elevator",
  "a penguin on vacation",
  ...
],
```

### Prompt rules

`npm test` checks the first five rules automatically, and the pull request will show a red ✗ if one fails.

1. **Start with a lowercase letter.** The game capitalizes it on screen.
2. **No punctuation at the end** (`.`, `!`, `?`, `,`, `;`, `:`).
3. **4 to 55 characters.**
4. **No duplicates** anywhere in the deck, in any category.
5. **At least 12 prompts per category,** so a long game never runs out.
6. **Drawable.** Someone should be able to sketch it in 90 seconds without writing words.
7. **Funny, not mean.** Keep it family friendly. No real people, brands or copyrighted characters.
8. **Good fakes are possible.** The best prompts are specific but leave room for believable fake titles. *"a sloth in a hurry"* is great. *"an animal"* is not.

### Adding a category

Add a new key to the object, with a short name (2 to 20 characters) and at least 12 prompts. Categories appear as toggles in the lobby automatically, so no other code changes are needed.

---

## Working on the code

### Setup

You need a browser and, for tests, [Node.js](https://nodejs.org/) 18 or newer. There are no dependencies to install.

```bash
git clone https://github.com/YOUR-USERNAME/sketchy.git
cd sketchy
npm start     # http://localhost:8080
npm test
```

### Testing a game on one computer

1. Open `http://localhost:8080` and choose **Host on the big screen**.
2. Open more tabs or windows and choose **Join on this phone** in each. Every tab is its own player.
3. Or add bots in the lobby with **Add a bot player**.

To test on real phones, serve the folder on your network and open `http://<your-computer-ip>:8080` on each phone. Use your browser's device toolbar to check phone layouts.

### Project layout

| File | What's inside |
|---|---|
| `index.html` | Page shell that loads the libraries, then `prompts.js`, `codec.js`, `game.js` |
| `styles.css` | All styles. `html.host` scopes the big-screen layout. Design tokens are at the top. |
| `js/prompts.js` | The prompt deck (works in the browser and in Node) |
| `js/codec.js` | Pure drawing functions: `encode`, `decode`, `rdp`, `chunk`, `paint`. Unit tested. |
| `js/game.js` | Everything else, in sections: utils, transport, home, HOST, PLAYER, actions, boot |
| `tests/` | `node:test` tests |
| `docs/ARCHITECTURE.md` | Protocol, phases, drawing format. **Read this before changing game flow.** |

### Principles

- **No build step, no framework.** Plain HTML, CSS and JavaScript that runs straight from a static host. Please don't add bundlers or npm runtime dependencies.
- **The host is the authority.** Phones only report what their player did. The host validates everything (`hHandle` in `game.js`) and decides the game state. Never trust data that comes from a phone.
- **Escape all user text.** Names, fake titles and anything else from a phone must go through `esc()` before it touches `innerHTML`.
- **Send absolute state, not events.** The host broadcasts its whole state object, and each phone sends its whole state object. That makes reconnecting trivial. Keep the objects small.
- **Phones first, TV second.** Every player screen must work one-handed on a small phone, with big tap targets and the main action at the bottom.
- **Accessible by default.** Visible focus, real buttons, labels on inputs, and `prefers-reduced-motion` respected.

### Code style

- 2-space indentation in new code. Match the style of the surrounding code.
- Keep functions small and named for what they do (`hToVote`, `pRender`).
- Host functions start with `h`, player functions with `p`.
- Comment the *why*, not the *what*.

### Before you open a pull request

- [ ] `npm test` passes.
- [ ] You played at least one full round (host + 2 tabs or bots) with your change.
- [ ] You checked the phone screens at a narrow width (about 375px).
- [ ] New user-facing text is short, friendly and clear.
- [ ] You updated `README.md` or `docs/ARCHITECTURE.md` if behaviour or the protocol changed.
- [ ] You added a line to `CHANGELOG.md` under **Unreleased**.

Keep pull requests focused: one feature or fix per PR is much easier to review.

### Changing the protocol

If you change what the host or a phone sends, players on an old cached page might be talking to a new host. Bump the version in `hostIdFor()` in `game.js` (`sketchy-party-v1-…` becomes `v2`), so old and new versions never connect to each other, and document the change in `docs/ARCHITECTURE.md`.

## Releases

Every push to `main` runs the tests and redeploys GitHub Pages. Maintainers tag releases (`v1.1.0`) and move the **Unreleased** notes in `CHANGELOG.md` under the new version.

## Questions?

Open a [discussion or issue](../../issues). There are no silly questions.
