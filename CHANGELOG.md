# Changelog

All notable changes to Sketchy are listed here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-11-08

### Added
- Big-screen host and phone players that connect directly over WebRTC (PeerJS). No accounts or server needed.
- Join by QR code or a 4-letter game code. A small QR stays in the corner during the game so dropped players can rejoin.
- 8 prompt categories with 160 prompts: Animals, Food, Jobs, Sports, Places, Fantasy, Everyday chaos, Parties.
- Lobby settings for categories, 1 to 3 rounds, and 60 s, 90 s or 2 min drawing time.
- Phone drawing canvas with 8 colors, 3 brush sizes, eraser, undo and clear.
- Compact stroke-based drawing format with stroke-by-stroke replay on the big screen.
- Fake titles with duplicate and accidental-truth detection, a "make one up for me" button, and house fakes for small groups.
- Voting, a two-step reveal, scoring, a final podium, the best fake, and a gallery of every drawing.
- Pause, skip ahead and end game controls on the big screen.
- Test mode with up to four bot players.
- Automatic reconnect for phones that lock or reload.
- Tests for the drawing codec and the prompt deck, CI, and automatic GitHub Pages deploys.
