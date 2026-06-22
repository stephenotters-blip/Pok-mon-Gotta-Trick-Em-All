# Pokémon: Gotta Trick 'Em All — Online Multiplayer

Real-time multiplayer build for up to 4 players, on separate devices/locations.

## Run it locally

```
npm install
npm start
```

Then open http://localhost:3000 in a browser. Open it again in other tabs/devices
on the same network (using your computer's local IP instead of localhost) to test
with multiple players.

## How to play

1. One person clicks **Create Room** — they get a 4-letter room code.
2. Everyone else enters that code on the home screen and clicks **Join Room**
   (up to 3 more players, 4 total).
3. Once at least 2 players have joined, anyone in the room can click **Start Game**.
4. Play proceeds exactly like the solo build, just with real people in each seat
   instead of bots. The server enforces turn order and legal plays — illegal
   moves are rejected automatically.

## Deploying for free so others can join from anywhere

### Option A: Render.com (free tier)
1. Push this folder to a GitHub repo.
2. On render.com, create a new "Web Service", connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Render gives you a public URL (e.g. `https://your-app.onrender.com`) —
   share that instead of localhost. Free tier sleeps after inactivity, so the
   first connection after a while takes ~30s to wake up.

### Option B: Replit (no GitHub needed)
1. Create a new Repl, choose Node.js, and upload these files (or import
   from a zip).
2. Click Run — Replit installs dependencies and starts the server automatically,
   and gives you a public URL immediately.

### Option C: Glitch
1. Create a new Glitch project, import this folder.
2. Glitch auto-installs and runs `npm start`. You get a public URL right away.

## Project structure

- `server.js` — Socket.io server; owns the authoritative game state, validates
  every move server-side, and sends each player a personalized view of the
  state (their own hand is visible, everyone else's is just a card count).
- `game-logic.js` — the actual rules engine (deck, tricks, scoring), shared
  logic ported from the solo prototype.
- `public/` — the client: HTML/CSS/JS, reusing the original UI, card art,
  and flip animations, but driven by state pushed from the server instead of
  running the game locally.

## Known limitations (good next steps if you want to keep building)

- No reconnect-to-same-seat after a page refresh/disconnect mid-game (you'd
  need to persist player tokens and let them rejoin their existing seat).
- No spectator mode.
- No bot fill-in for empty seats if fewer than 4 people join.
- Render's free tier will sleep the server after ~15 min idle; fine for casual
  use, but the first join after sleeping will be slow.
