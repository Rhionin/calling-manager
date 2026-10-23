# Calling Manager

A private, browser-only calling board for a ward membership clerk. Paste an LCR-style callings report, rearrange the board, and keep the work on this computer.

The original Calling Manager was written by Justin Sirois (Tech Forum user jds580s) and published at [callingmanager.com](https://callingmanager.com/). The author has described that code as open source. The captured site did not include a license file. This copy keeps that attribution. It does not add a license the original author did not publish.

The first commit in this branch is the unmodified client capture. Later commits are the local fork.

## Privacy

Member names and callings stay in the browser.

- The page does not upload the paste. The old `callings.php` form action, demo `load.php` requests, `random.php` background request, and `copyright.php` frame are gone.
- jQuery, jQuery UI, Touch Punch, jQuery Validation, Moment, Bootstrap, Bootbox, and Font Awesome are files in `vendor/`. Lato and Fjalla One are files in `vendor/fonts/`. The page does not call a CDN or Google Fonts.
- A Content-Security-Policy meta tag sets `connect-src 'none'`, `frame-src 'none'`, `object-src 'none'`, and `form-action 'none'`. The browser refuses connections the page might try to open. `script-src` is `'self'` only. `style-src` allows inline styles because jQuery UI positions a dragged card with an inline style.
- The board is saved in this browser (localStorage, and IndexedDB when the browser allows it). Export writes a JSON file only when you ask. Optional passphrase encryption uses WebCrypto (PBKDF2 and AES-GCM) in the browser before the file is downloaded. The passphrase is not stored.
- The sample ward is fictional. Do not commit a real member export to git.
- Links to Church sites are ordinary links. They run only if you choose to open them. The page sends no member data with them.

After the page has loaded, you can disconnect from the network and keep working.

## Use the board

1. Open `index.html` in a browser, or host this folder as static files.
2. Load the fictional sample, or paste JSON for your unit and choose **Build the board**. The text box is cleared after a successful build.
3. People without a calling sit in the **Unassigned** panel. It stays on screen while you scroll, and it can be collapsed.
4. To assign someone without dragging:
   - Click the person's name. A banner at the bottom confirms who you are placing. Then click the calling.
   - Or choose **Assign** on the person, search for the calling, and press Enter.
   - Or choose **Place** (or the calling name) and pick a person. Vacant callings are listed first.
   - Esc, or clicking the same name again, cancels a placement.
5. Dragging still works. Moving the pointer near the top or bottom edge of the window scrolls the page. **Lock drag** leaves the cards in place so a touch screen can scroll.
6. **Find** narrows the board. Press `/` to focus it, then Enter to jump to the first match.
7. **List** is a compact table of the same board. Status changes there are the same records as on the board.
8. **Release** moves a person to Unassigned and records a release. **Remove** deletes a name you added by hand.
9. **Pending** lists the next step for each release and each new calling: proposed, bishopric approval, extended, accepted, sustained, set apart, and recorded in LCR. Releases use proposed, approved, released/announced, and recorded in LCR.
10. Select rows and choose **Sacrament wording**. Releases are drafted first, then sustainings. Read the draft in bishopric meeting before using it.
11. **Export** downloads `calling-board-YYYY-MM-DD.json`. Turn on the passphrase option when you want the file encrypted. **Import** reads that file back. **Clear** removes the board from this browser and leaves exported files where you saved them.
12. **Print** still uses the original print styles for changes or for every calling.

The board saves itself. The header shows when this browser last stored it. Export when you want a copy that survives clearing the browser.

## Run it

Open `index.html` directly, or from this folder:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080/`.

GitHub Pages can serve this repository as static files from the repository root. This folder includes `.nojekyll`. `https://` is a secure context, so passphrase encryption is available there. Some browsers limit storage or WebCrypto on `file://` pages. Export still works as a download or as text you can copy from the export box.

There is no build step and no server.

## Hosting

The live site is [https://callings.rhionin.com](https://callings.rhionin.com). It is an assets-only Cloudflare Worker named `calling-manager`. Wrangler uploads the files at the repository root. `.assetsignore` leaves out tests, `.github`, docs, and Node files. There is no Worker script.

`workers.dev` and preview URLs are off. A push to `main` runs the tests, then deploys with Wrangler 4.152.0 (`cloudflare/wrangler-action` v4.1.3). A pull request runs the same tests and `wrangler deploy --dry-run`, and skips the deploy job. Only that job can read the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Fork pull requests do not run it.

The token permissions below are the minimum described by Cloudflare’s [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/) (15 Sep 2026) and [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) (29 Sep 2026):

- Account **Workers Scripts:Edit**. That legacy permission is **Editor** at the Workers product scope. It deploys an existing Worker.
- Zone `rhionin.com` **Workers Routes:Edit** (current docs: Zone > Workers Routes > Write). The config keeps the custom domain `callings.rhionin.com`, so a deploy that attaches or updates that domain needs this.
- Zone **DNS:Edit** is not part of that set. Cloudflare creates the custom-domain DNS record and certificate. The docs require Editor plus Workers Routes Write for the change, and the Attach Worker Domain API lists Workers Scripts Write only.

Creating the Worker the first time needs product-level **Workers Admin**. Editor cannot create a Worker, and a per-worker role cannot be granted until it exists. Custom domains also do not use per-worker roles. Create an empty Worker named `calling-manager` in the account before relying on the token above, or use Admin for that first deploy and then replace the token. The zone `rhionin.com` must already be on the account, and `callings.rhionin.com` must not already have a CNAME record.

The response Content-Security-Policy header repeats the meta tag in `index.html`, including `connect-src 'none'`. `X-Frame-Options: DENY` is separate so the two CSP strings stay the same. `frame-ancestors` is not in the policy because a meta tag would ignore it.

Roll back with `npx wrangler rollback`. That immediately serves an older version on the same domain. With no version id it returns to the version before the latest. You can pass a version id. Rollback reaches the 100 most recent versions and does not change DNS or other Cloudflare resources.

## Paste format

The old LCR address `https://lcr.churchofjesuschrist.org/api/orgs/sub-orgs-with-callings` has returned 404 since March 2026. This page does not call LCR. It reads whatever JSON you paste.

It accepts:

- A list of organizations with `defaultOrgName` (or `orgName`), `callings` (or `positions`), and nested `children`.
- A larger object that contains that list somewhere inside it.

Each calling uses `position` (or `positionName`) and `memberName`. A missing or blank member is a vacancy. `activeDate` may be `YYYYMMDD`. `setApart` may be true or false.

Out-of-unit callings are still unavailable, as they were on the original site.

## Tests

```bash
node test/parse-callings.test.js
node test/pipeline.test.js
node test/crypto-file.test.js
```

## Third-party code

See `vendor/NOTICES.md`. Font license texts are in `vendor/fonts/`.

## Limits

- This bookkeeping does not write back to LCR. Recording a calling in LCR is still a step you do in LCR.
- Sacrament sentences are a starting draft, not a substitute for the bishop's review.
- The March 2026 LCR change means the one-click report link from the original site no longer returns JSON. You need another way to copy organization JSON into the box.
- Bootbox 5 is included because the original page loaded it. Its alerts depended on Bootstrap's old jQuery modal plugin, which Bootstrap 5 removed, so the dialogs in this copy are the page's own.
- Drag-and-drop auto-scroll depends on the browser delivering pointer events during a drag. Assign and Place do not.
- Autosave in this browser is not encrypted. Anyone who can open this browser profile can read the board. The passphrase option encrypts only the exported file.
- Opening the file directly (`file://`) can block IndexedDB, localStorage, or WebCrypto in some browsers. Use localhost or GitHub Pages when you want autosave and encryption, and keep an export either way.
