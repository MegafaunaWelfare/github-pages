# Megafauna Welfare Foundation website and app

The website of **Megafauna Welfare Foundation**, a Chandigarh-based non-profit that protects stray and neglected animals across the Chandigarh Tricity through daily feeding, emergency veterinary aid, legal aid and community sensitisation, together with **MegaFauna Care**, the foundation's free app for reporting animals in need and looking after community animals.

Live site (once GitHub Pages is enabled): <https://megafaunawelfare.github.io/github-pages/>
The app: <https://megafaunawelfare.github.io/github-pages/app/>

## What's here

```
index.html            The whole site (one page, in sections)
404.html              "Page not found" page (self-contained)
assets/css/styles.css Styles: colours and fonts are set at the top in :root
assets/js/main.js     Mobile menu, scroll effects, contact form
assets/img/logo.svg   Logo and browser icon
assets/img/og-image.png  Preview image shown when the link is shared
app/                  The MegaFauna Care app (see below)
.nojekyll             Tells GitHub Pages to serve the files as they are
```

The site and the app are plain HTML, CSS and JavaScript, so there's no build step and nothing to install.

## Publishing with GitHub Pages

1. Merge the changes into `main`.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*, choose `main` and `/ (root)`, then **Save**.
4. After a minute or two the site is live at the address above, and the app is at `/app/`.

## Editing the content

All text is in `index.html`, grouped by section (`<!-- About -->`, `<!-- Our work -->`, and so on). Open the file on GitHub, click the pencil icon, edit, and commit. The site updates automatically.

### Before launch

- **Contact email:** replace `contact@example.org` in `index.html`. It appears twice: in the contact list and in the form's `data-email` attribute. Search the file for `TODO`.
- **Phone / WhatsApp / social media:** add them to the contact list in the `<!-- Contact -->` section if you'd like them shown.
- **The app's WhatsApp number and email:** see [Setting up the app](#setting-up-the-app) below.
- **Photos:** real photos of your work will make the site far more powerful. Add them to `assets/img/` and reference them from `index.html`.

### Using a custom domain

If you move to your own domain (for example `www.yourdomain.org`), set it under **Settings → Pages → Custom domain** and update the two `og:` URLs near the top of `index.html` (and of `app/index.html`) so link previews keep working.

## The MegaFauna Care app

A phone-first app that anyone can open from the website. It has five parts:

- **Report**: someone who finds an injured, sick or trapped animal answers a few questions (what's happening, which animal, warning signs, where, with an optional GPS location) and gets a ready-made message to send to the rescue team on WhatsApp, by email or by copying it. First-aid advice for their situation appears as soon as they pick it.
- **Animals**: feeders and volunteers keep a record of the community animals they look after: a photo, where they live, how to recognise them, whether they're sterilised, and a health history (anti-rabies and other vaccines, sterilisation, deworming, tick treatment, vet visits, injuries, reflective collars). The app works out when boosters are due and lets people share an animal's details, for example with an RWA or a vet.
- **Today**: what needs attention (overdue and upcoming vaccines and treatments), how many of your dogs are sterilised and vaccinated against rabies (with the WHO's 70% target), this week's feeding, and a tip for the season.
- **Feeding**: a log of feeding rounds, with meals per day over the last two weeks.
- **Guide**: what to do for an animal in need, first aid for common emergencies, the law that protects animals, and good practice for feeders. The steps and the law text match the website.

The first time someone opens the app it shows clearly marked example records so they can see how it works; one button removes them.

### Where the records are kept

Everything is saved in the browser on the person's own phone or computer. Nothing is sent to the foundation or anywhere else, and the app has no server to look after. The flip side is that records don't sync between devices, and clearing the browser's data deletes them. That's why **More → Your records** offers a backup file (photos included) that can be restored on the same or a new phone. The app reminds people to make one.

Once opened, the app also works offline, and people can add it to their home screen (**More → Add to your home screen** explains how).

### Setting up the app

Open `app/app.js` and fill in the settings at the top:

```js
const CONFIG = {
  whatsappNumber: '',   // for example '919876543210': country code, then the number, digits only
  email: '',            // the foundation's public email address
  ...
};
```

- With **`whatsappNumber`** set, reports open straight in a chat with the foundation. While it's empty, people choose who to send the report to.
- With **`email`** set, reports also get an **Email** button.

### Changing the app's text

- First-aid advice, the law cards, feeding tips and the seasonal tips are lists near the top of `app/app.js` (`FIRST_AID`, `LAWS`, `CARE`, `SEASON_TIPS`). Edit the sentences there.
- How often each treatment is usually repeated is in `RECORD_TYPES` (for example `months: 12` for the anti-rabies vaccine). People can always change the next due date themselves.
- Colours and fonts are set at the top of `app/app.css`, in the same palette as the website, with a dark version below.

### Releasing a new version of the app

The app keeps a copy of its files for offline use. After changing files in `app/`, also change the version in `app/sw.js` (`megafauna-care-v1` → `megafauna-care-v2`). People already get the newest files whenever they're online; the new version name clears out the old offline copy.

## Sources for the facts on the site

The programme details come from the foundation's public listings (Give.do and company registry entries, CIN U85500PB2024NPL061864). Please review all text, especially the figures and the "Know the law" section, and keep it up to date.

The app's first-aid advice is general guidance for people without veterinary training, and its legal text is general information, not legal advice. It's worth asking a vet and a lawyer you work with to read the app's Guide before you promote it widely.
