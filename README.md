# RandomScroll (Netlify + Netlify Blobs)
Accounts, likes, saves, follows, comments and view counts are stored in Netlify Blobs. No database needed.

## Deploy
1. Push this folder to a GitHub repo (`.env` is git-ignored; never commit it).
2. Netlify > Add new site > Import from Git > pick the repo (no build command; publish dir `public`).
3. Site configuration > Environment variables:
   - JWT_SECRET (required): any long random string
   - YOUTUBE_API_KEY (optional)
   - ADMIN_IDS (optional): comma-separated User IDs or emails that get the Admin panel, e.g. `User_839201,me@example.com`
4. Deploy. Drag-and-drop deploys do NOT include functions; use Git or `netlify deploy --prod`.

Local: `npx netlify dev` (copy `.env.example` to `.env`).

## Admin panel (`#admin`)
Create your account, put its ID or email in `ADMIN_IDS`, redeploy. An Admin tab appears for you only; every admin API route re-checks on the server.
- Users: search by ID prefix or exact email, ban (permanent or N days, with a reason shown to the user), unban, reset a birthday.
- Troll tools (per user): add or remove fake followers, following and likes (only the owner sees them on their Profile), verified ✔ badge, force a display name, send a one-time pop-up message. Fake upload: adds 1-5 random real videos to their account under their name with made-up views and likes.
- Bans can also block sign-ups from the user's network (hashed IP). Shared networks can catch innocent people, so use sparingly.
- Reports: videos people reported, with reasons; block (removes from all feeds) or dismiss.
- Comments: flagged/hidden comments; hide, restore, delete, ban the author.
Banned users are logged out and cannot log in or use any endpoint.

## Birthday and 18+ videos
- Sign-up asks for a date of birth (13+). Existing accounts add one in Settings; it can only be set once (admins can reset it).
- 18+ videos need: birthday on file showing 18+, the "Show 18+ videos" setting, and a per-session confirmation. This is enforced server-side, not just hidden in the UI.
- Adult videos come from Pornhub's public webmasters (HubTraffic) REST API, the same API the `pornhub-api` PyPI package wraps. Netlify Functions cannot run Python, so `api.mjs` calls those endpoints directly and plays videos with Pornhub's embed player.
- A self-entered birthday is not legal age verification (see notes in the chat reply).
