# NOVA AI: independent website

This is NOVA 2.0 packaged to run as its own website on Netlify, outside Claude Artifacts.
You do not need to install anything on your computer. Netlify builds the site from this folder.

## What is in the project

| Path | What it is |
| --- | --- |
| `src/*.js` | The NOVA app, in order. `build.sh` joins them into one script. |
| `nova.css`, `nova-plus.css` | Styles. |
| `build.sh` | Builds the site into `dist/` using only `cat`, `mkdir` and `cp`. |
| `netlify.toml` | Build and publish settings for Netlify. |
| `netlify/functions/chat.mjs` | The AI endpoint, served at `/api/chat`. It holds the API key and calls the model. |
| `public/favicon.svg` | The NOVA icon. |

Framework: none. The app is plain React 18 loaded from cdnjs, with `htm` for templates. No npm packages are needed.

## Deploy on Netlify (no local install)

1. **Put the project on GitHub.** On github.com, create a new repository. Choose "Add file" then "Upload files", and upload the contents of this folder (not the folder itself). Commit.
2. **Create the site on Netlify.** Sign in at netlify.com, choose "Add new site" then "Import an existing project", and pick your GitHub repository. Netlify reads `netlify.toml`, so the build command (`bash build.sh`) and the publish folder (`dist`) fill in automatically. Click "Deploy".
3. **Add your AI key.** In Netlify, open the site, then "Site configuration" then "Environment variables". Add a variable named `ANTHROPIC_API_KEY` with your key as the value. Give it the "Functions" scope, or all scopes. Save.
4. **Redeploy.** Open "Deploys" and choose "Trigger deploy". Netlify needs a new deploy to pick up the key.
5. **Check it.** Open `https://YOUR-SITE.netlify.app/api/chat` in a browser. You should see `{"configured":true}`. The key itself is never shown. Then open the site and send a message in Assistant.

Keep the key secret. Do not paste it into any file in this project, and do not put it in a variable named with `VITE_` or `NEXT_PUBLIC_`, because those reach the browser.

## Changing the models

The model for each speed tier is set in `netlify/functions/chat.mjs`:

```js
const MODELS = { quick: "claude-haiku-5-5", default: "claude-sonnet-5-5", complex: "claude-opus-5-5" };
```

Check these names against the current model list before launch. If a name is retired, the site returns a clear error instead of a made-up answer.

## Cost and abuse controls

- Set a monthly spending limit in your Anthropic account before you open the site to visitors.
- The endpoint limits each visitor's address to 30 requests a minute. This is best effort: Netlify runs several copies of the function, so the limit is not exact. Use the spending limit as your real safeguard.
- The app also limits each signed-in plan to a daily message count in the browser. A determined visitor can get around that, so treat it as a plan feature, not a security control.

## What works on the independent site

- Chat, Developer, Research, Gaming (Roblox and Fortnite Creative help), Studio (SVG images), Council (Ultra), Agent, Planner and Memory use the server endpoint for AI replies.
- Your notes, plans, memory and settings are saved in the visitor's own browser (localStorage). Nothing is stored on the server.
- Exports (memory, plans, images) download directly from the browser.
- Owner preview tools are hidden, because there is no Artifact owner on an independent site.

## What is not included yet

- **Payments.** NOVA Pro, Max and Ultra cannot be bought from this site yet. The plan buttons stay disabled until a payment provider is connected.
- **Real license keys.** Keys are checked in the browser, so anyone can forge one. Before you take money, add a server check tied to your payment webhook.
- **Accounts.** There are no user accounts. Data stays on each visitor's device.
- **Terms and privacy policy.** Add them before you accept payments or collect any personal data. Replace the placeholders in the footer and contact section.
- **Voice output quality.** Speech depends on the browser and device.

## Testing

Checks run before packaging (with a stubbed model, so they do not call Anthropic):

- The endpoint returns the right model, key handling and error codes for 16 cases.
- The site loads and sends a chat message through `/api/chat` in a real browser, and shows the reply.
- The Artifact version of the app still passes its 45 and 34 regression checks.

These checks do not prove that your live key and Netlify deployment work. Step 5 above is the real test.
