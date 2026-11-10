# Lia Libras

PWA to collect, review and recognize Libras signs. The video stays on the device. The app sends only pose and hand landmarks.

- `src/`: site (React, TypeScript, Vite, PWA).
- `server/`: API (Hono). `api/index.ts` is the Vercel entry point.
- `shared/`: code that the site and the API use (capture format, hand rule, metrics).
- `contract/`: data formats, Firestore schema, API routes and release format.
- `tests/`: API tests and Firestore rules tests.

## Local development
Install: Node 22 or later, and Java 21 (for the Firebase emulators).

```bash
npm install
```

Create `.env.development.local` with `VITE_EMULATORS=1`. Then start the emulators and the API:

```bash
npx firebase emulators:exec --only auth,firestore --project demo-libras "npm run api"
```

In a second terminal, start the site:

```bash
npm run dev
```

Local recordings go to the `local_bucket/` folder. The emulators do not keep data after they stop.

## Tests
```bash
npm --prefix tests/firestore-rules install
npx firebase emulators:exec --only auth,firestore --project demo-libras "npm test && npm --prefix tests/firestore-rules test"
```

GitHub Actions runs the type check, the tests and the build on each push (`.github/workflows/ci.yml`).

## Deploy
Vercel builds each push to `main`. Set these environment variables in Vercel: `FIREBASE_SERVICE_ACCOUNT_JSON`, `LIA_FIREBASE_PROJECT_ID`, `LIA_STORAGE=hf`, `LIA_HF_BUCKET`, `HF_TOKEN`.

Deploy the Firestore rules and indexes after each change to them:

```bash
npx firebase deploy --only firestore
```

To make a person an admin, set `role` to `admin` in the `users/{uid}` document in the Firebase console.
