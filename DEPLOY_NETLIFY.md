# Safe Netlify deployment

ECHONOMY uses Netlify Functions for the Genius and Apple preview proxy.
The browser never receives `GENIUS_ACCESS_TOKEN`.

## 1. Create a separate Netlify site

From this project directory:

```powershell
npx netlify-cli@latest login
npx netlify-cli@latest sites:create --name YOUR-UNIQUE-SITE-NAME
npx netlify-cli@latest deploy
```

`sites:create` creates an empty project and links it to this folder. Use a new
site name; do not replace an unrelated existing site. `deploy` creates a draft
deploy first so you can inspect it before touching the production URL.

## 2. Set runtime environment variables in Netlify

In the new site's Netlify dashboard, open **Site configuration > Environment
variables** and add:

- `SPOTIFY_CLIENT_ID`: the public Spotify Client ID
- `GENIUS_ACCESS_TOKEN`: the private Genius client access token

Give the variables access to Functions (or all scopes on the free plan). Never
put the Genius token in `netlify.toml`, frontend JavaScript, Git, screenshots,
or chat. Environment-variable changes require a new deploy.

## 3. Add the production Spotify redirect

In the Spotify Developer Dashboard, open the app settings and keep the local
redirect while adding the production redirect:

```text
http://127.0.0.1:5173/callback
https://echonomy.limiliminal.com/callback
```

Also set the app website to `https://echonomy.limiliminal.com` and save.

## 4. Publish production

```powershell
npx netlify-cli@latest deploy --prod
```

Then test the demo, Spotify login, a small scan, a source preview, and creation
of a private roots playlist.

## Important Spotify limitation

The site and demo can be public, but a Spotify app in Development Mode is not a
general-public integration. The owner needs Premium and only five allowlisted
Spotify users can use the live Spotify features. Add testers in Spotify's User
Management settings. Other visitors can still use the public demo.
