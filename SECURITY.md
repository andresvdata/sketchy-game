# Security

Sketchy runs entirely in the players' browsers and stores no data on a server. Even so, we take issues like script injection through player names or fake titles seriously.

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Report them privately with GitHub's **Report a vulnerability** button on the repository's **Security** tab, or contact a maintainer directly on GitHub.

Include steps to reproduce and, if you can, a suggested fix. We'll reply as soon as we can and credit you in the changelog if you'd like.

## Scope

In scope:
- Injecting HTML or script through anything a phone sends (names, fakes, drawing data)
- Ways one player can crash or take over another player's or the host's game

Out of scope:
- Reading other players' prompts with browser dev tools (a known trade-off, see `docs/ARCHITECTURE.md`)
- Problems in PeerJS or its public broker. Please report those [to PeerJS](https://github.com/peers/peerjs).
