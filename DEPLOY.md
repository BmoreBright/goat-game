# G.O.A.T. Debate — Deploy Guide (Vercel + Railway)

## 1. Multiplayer Server (Railway)

1. Create a new Railway project.
2. Deploy from a GitHub repo (or use the CLI / drag-and-drop).
3. Make sure the root of the service contains:
   - `index.js` (the server file)
   - `package.json` with `"start": "node index.js"` and the `ws` dependency
4. Railway will automatically inject `PORT`. The server already reads `process.env.PORT`.
5. After deploy, copy the public domain (e.g. `goat-debate-production.up.railway.app`).
6. Your WebSocket URL will be:
   ```
   wss://goat-debate-production.up.railway.app
   ```

## 2. Frontend (Vercel)

1. Push your full React project to GitHub (Vite + React assumed).
2. Import the repo in Vercel.
3. Add an **Environment Variable**:
   - Name: `VITE_WS_URL`
   - Value: `wss://your-railway-domain` (from step 1)
4. Deploy.

### Required files in the frontend project

- Replace your local `src/multiplayer.js` (or wherever it lives) with the updated version.
- The one-line change in `App.jsx` that hides the localhost hint in production is already applied in the provided `App.jsx`.

### Optional PWA polish

1. Put `manifest.json` in your `public/` folder.
2. Create two icons and place them in `public/icons/`:
   - `icon-192.png`
   - `icon-512.png`
3. In `index.html` add:
   ```html
   <link rel="manifest" href="/manifest.json" />
   <meta name="theme-color" content="#eab308" />
   ```

After the first successful deploy the “Install” / “Add to Home Screen” banner will work on supported browsers.

## 3. Local development still works

- Frontend: `npm run dev`
- Server: `node index.js` (or `npm start`) on port 3847
- The client automatically falls back to `ws://localhost:3847` when `VITE_WS_URL` is not set.

## Quick test checklist

- [ ] Open the Vercel URL on your phone
- [ ] Create a room → note the 4-letter code
- [ ] Open the same URL on another device / browser → join with the code
- [ ] Host starts the game and both players see the same table
