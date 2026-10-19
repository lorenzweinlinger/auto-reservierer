# Auto-Reservierer

A small website for the family to reserve one of the two cars. It runs on GitHub Pages (free) and stores reservations in Supabase (free).

- See right away which car is free and who has it.
- A 7-day overview shows every reservation.
- Reserve in a few taps: pick a car, pick the time, done. Two people can't book the same car at the same time.
- Login is a shared family code. Send the family a link with the code in it, and each person taps their name once. The phone remembers both.

## Setup

### 1. Supabase (database)

1. Create a free account at https://supabase.com. Signing in with GitHub works. Then create a **New project**: pick any name and password, and the region **Central EU (Frankfurt)**.
2. Open **SQL Editor** → **New query** and paste the contents of [`supabase/setup.sql`](supabase/setup.sql).
3. In the pasted SQL, replace `HIER-CODE-EINTRAGEN` with your family code. Pick something that's hard to guess, e.g. `sonnenblume-42-garage`.
4. Press **Run**. It should say "Success".
5. Go to **Project Settings → API Keys** (or the **Connect** button) and copy:
   - the **Project URL** (`https://xxxx.supabase.co`)
   - the **publishable key** (`sb_publishable_…`) or the legacy **anon** key

   Both are fine to put on a public website, because the database only answers when the family code is correct.

### 2. Configure the site

Edit [`config.js`](config.js) and fill in `supabaseUrl`, `supabaseKey`, the five names and the two car names.

### 3. GitHub Pages

Go to the repo's **Settings → Pages**, then under **Build and deployment** choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save. After about a minute the site is live at `https://<username>.github.io/auto-reservierer/`.

### 4. Share it

Send the family this link:

```
https://<username>.github.io/auto-reservierer/#code=YOUR-FAMILY-CODE
```

Opening it logs them in, and they tap their name once. Tip: use "Add to Home Screen" so it opens like an app.

## Changing things

- **Names or cars:** edit `config.js`. Don't change a car's `id` after it has reservations. Changing its `name` and `color` is fine.
- **Family code:** in the Supabase SQL Editor run
  `update app_config set value = 'new-code' where key = 'family_code';`
  Everyone is then asked for the new code, or you send the new link.
- **Try it without a database:** leave `supabaseUrl` empty. The site runs in demo mode with the code `demo`, and the data stays on that device only.

## Notes on security

The family code keeps strangers out, but it's not bank-level security. Anyone with the code can see and change reservations, and the person names aren't verified. Supabase pauses free projects after a week with no activity. Normal use keeps it awake, and if it does pause you can restore it from the dashboard with one click.
