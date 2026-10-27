# Megafauna Welfare Foundation website and apps

The website of **Megafauna Welfare Foundation**, a Chandigarh-based non-profit that protects stray and neglected animals across the Chandigarh Tricity through daily feeding, emergency veterinary aid, legal aid and community sensitisation, together with two apps:

- **MegaFauna Care**, the foundation's free app for reporting animals in need and looking after community animals.
- **MegaFauna Casebook**, the team's encrypted case files for cruelty investigations and legal aid.

Live site (once GitHub Pages is enabled): <https://megafaunawelfare.github.io/github-pages/>
The Care app: <https://megafaunawelfare.github.io/github-pages/app/>
The Casebook: <https://megafaunawelfare.github.io/github-pages/casebook/>

## What's here

```
index.html            Homepage
about.html            About us: story, mission, where we work, registration details
work.html             Our work: the five projects and the drives
help.html             Animal in need? Steps, first aid, reporting cruelty, tips for feeders
law.html              Know the law
news.html             News, each item linked to the published report it's based on
get-involved.html     Volunteering, internships and other ways to help
donate.html           Donate, other ways to give, questions about giving
contact.html          Contact details and a message form
404.html              "Page not found" page (self-contained)
assets/css/styles.css Styles: colours and fonts are set at the top in :root
assets/js/main.js     Mobile menu, scroll effects, card scrolling, contact form
assets/img/logo.svg   Logo and browser icon
assets/img/illustrations/  The site's drawings (see "Illustrations and photos" below)
assets/img/og-image.png    Preview image shown when a link to the site is shared
app/                  The MegaFauna Care app (see below)
casebook/             The MegaFauna Casebook, the team's case files (see below)
tests/                Tests for the Casebook's encryption, file format and merging
.nojekyll             Tells GitHub Pages to serve the files as they are
```

The site and the apps are plain HTML, CSS and JavaScript, so there's no build step and nothing to install.

### How the site is laid out

The site follows the pattern of the best wildlife charity websites, such as the Sheldrick Wildlife Trust's, adapted for street animals in the way Animal Aid Unlimited's site puts reporting an injured animal first:

- An **emergency bar** at the top of every page links straight to reporting an animal in the Care app.
- A full-width **illustrated hero** with two clear actions: donate, or get help for an animal.
- **Impact figures**, **project cards**, a scrolling **"Who we help"** row, a **sanctuary** feature, an **emergency guide**, **news**, **the law**, ways to **get involved** and a **donate** panel on the homepage, each leading to its own page.
- A large **footer** with every page and the foundation's registration details.

Only the structure and approach are borrowed. All the text, drawings and branding are the foundation's own.

## Publishing with GitHub Pages

1. Merge the changes into `main`.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*, choose `main` and `/ (root)`, then **Save**.
4. After a minute or two the site is live at the address above, the Care app is at `/app/` and the Casebook at `/casebook/`.

## Editing the content

Each page is its own HTML file, and its text is grouped by section (`<!-- Our work -->`, `<!-- News -->`, and so on). Open the file on GitHub, click the pencil icon, edit, and commit. The site updates automatically.

- **The menu and footer** are repeated at the top and bottom of every page. If you add, rename or remove a page, change the menu (`<nav class="site-nav"`) and the footer (`<footer class="site-footer">`) in each `.html` file.
- **The figures** (1,000+ animals fed every day, 12 active legal cases) appear on the homepage, `work.html` and `about.html`. Search the files for them when they change.
- **News:** to add an item, copy one `<article class="news-item">` block in `news.html`, put it first and change the text and links. To show it on the homepage too, replace the first card in the `<!-- News -->` section of `index.html`.

### Before launch

- **Contact email:** replace `contact@example.org` in `contact.html`. It appears twice: in the contact list and in the form's `data-email` attribute. Search the file for `TODO`.
- **Phone / WhatsApp / social media:** add them to the contact list in `contact.html` if you'd like them shown.
- **The app's WhatsApp number and email:** see [Setting up the app](#setting-up-the-app) below. Every "Report it now" button on the site opens the app's report form.
- **Check the facts:** see [Sources for the facts on the site](#sources-for-the-facts-on-the-site). In particular, confirm the 80G wording with Give.do and that the news items are described the way you'd like.

### Illustrations and photos

The drawings in `assets/img/illustrations/` are original illustrations made for this site, in the site's colours. They're drawings, not photos of the foundation's animals, so nothing on the site pretends to show a real rescue.

Real photos of your work will make the site far more powerful. To swap a drawing for a photo, add the photo to `assets/img/` (a JPEG around 1600 pixels wide for the homepage hero, 1200 pixels wide for the others) and change the `src` of the matching `<img>`. Write an `alt` text that says what the photo shows, for example `alt="Volunteers feeding dogs in Sector 22"`. Use photos you took or have permission to use.

### Using a custom domain

If you move to your own domain (for example `www.yourdomain.org`), set it under **Settings → Pages → Custom domain** and update the `og:url` and `og:image` addresses near the top of each page (and of `app/index.html`), and the addresses in the `application/ld+json` block on the homepage, so link previews keep working.

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

## MegaFauna Casebook (for the team)

A secure case file for the foundation's cruelty investigations and legal aid work, at `/casebook/`. Each case keeps together what happened, the animals, the people involved, the evidence, a diary, tasks, and the police and court details. The website links to it from the footer as **Team casebook**, and search engines are asked not to list it.

- **Overview**: urgent cases, overdue tasks, hearings in the next two weeks, cases that have gone quiet, open cases by stage, cases by type, new cases by month, and recent activity.
- **Cases**: search across everything (titles, places, people, FIR numbers, file fingerprints) and filter by stage, type and place.
- **A case**: what happened and a case-file checklist (photos, vet or post-mortem report, witnesses, CCTV, police complaint, FIR copy, the certificate for electronic evidence), the animals, the people (reporters and witnesses are marked *confidential*), the evidence, a diary, tasks, the legal details (police station, FIR, sections, investigating officer, court, next hearing, lawyer) and everything that was done to the case.
- **Evidence**: original photos, videos, recordings and documents are stored exactly as they are, with a SHA-256 fingerprint worked out as each one is added. The date, time and GPS position are read from photos' camera data. Each file's history shows who added it, every fingerprint check, every unencrypted copy saved, each time it was shared, and any custody notes. Physical items, like a food sample or a weapon, can be recorded too.
- **Case report**: a report to print or save as a PDF, listing every file's SHA-256 fingerprint for the lawyer preparing the certificate for electronic evidence under section 63(4) of the Bharatiya Sakshya Adhiniyam, 2023, whose form asks for each record's hash value. Confidential people are left out unless you include them.
- **Investigation guide**: gathering evidence that holds up, going to the police (and what to do if an FIR isn't registered), and electronic evidence in court.

The first time it opens, the Casebook asks for the person's name and a passphrase. **Show example cases** (on the empty Overview, or in Settings) adds made-up cases to try it out; they're never shared and one button removes them.

### How the cases are kept safe

- **Encrypted on the device.** Everything is encrypted with AES-256-GCM before it's saved in the browser. The key comes from the person's passphrase (PBKDF2-SHA-256 with 600,000 rounds, unlocking a random 256-bit master key), and the passphrase itself is never stored. Each record, and each 4 MB piece of each file, is sealed separately and labelled with what it is, so anything changed, swapped or cut short fails to decrypt instead of being trusted.
- **No server, and no way out.** The page's Content Security Policy stops it connecting to anything (`connect-src 'none'`) or loading anything from other websites; even the fonts are served from `casebook/fonts/`. Trusted Types allow only the app's own escaping code to add markup. Case details are kept out of page titles, so they don't end up in the browser's history.
- **It locks itself** after a chosen time without use (10 minutes unless changed), or as soon as you switch apps if you turn that on. Only one tab can have the Casebook open at a time.
- **A tamper-evident activity log.** Every change is logged with who made it, on which device and when. Each device links its entries in a chain of SHA-256 hashes, so **Settings → Check the log** finds entries that were changed or removed. Logs from different devices are joined, never overwritten.
- **Fingerprints that travel.** Evidence files are checked against their SHA-256 fingerprint whenever they move between devices, and again whenever anyone asks.

### Working as a team

There's no central server, so the team combines cases by passing encrypted **Casebook files** (ending in `.casebook`) to each other:

1. In a case, or under **Share**, choose **Create a Casebook file**: pick the cases, whether to include evidence files, and whether to include confidential people (they're left out unless you tick the box). The app suggests a passphrase for the file.
2. Send the file however is convenient (WhatsApp, email, a USB stick) and tell the passphrase separately, in person or by phone.
3. The person receiving it chooses **Share → Add cases from a file**, and sees what's new and what's changed before anything is added.

Cases are combined record by record: every case, animal, person, file, diary entry and task has its own identity, and where two people changed the same record, the most recent change is kept. Deletions travel too, and a case deleted by mistake can be brought back from an older file. A legal coordinator can collect files from everyone in the field and send the combined cases back out.

### Backups

The cases live only in the browser they were entered in. **Share → Back up everything** makes one encrypted file with every case, file and log entry. Keep it away from the device; adding it to a newly set-up Casebook brings everything back. The app reminds people when a week has passed without a backup.

### Good to know

- **A forgotten passphrase can't be recovered**, by anyone. The way back is a backup or a colleague's Casebook file.
- **An unlocked device is an open casebook.** Encryption protects the cases while the Casebook is locked; while it's open, anyone holding the device can read them. Unencrypted copies of evidence, printed reports and saved PDFs are outside its protection.
- **Every site published from this GitHub account shares one address (`megafaunawelfare.github.io`)**, so their pages could interfere with each other's stored data, although they can't read the encrypted cases. Only publish sites you trust from this account, or give the Casebook its own domain.
- The browser may clear stored data when a device is very low on space. **Settings → Storage** asks it to keep the Casebook; backups cover the rest.
- Names typed into summaries, diary entries and tasks stay in that text even when confidential people are left out of a shared file.

### Changing the Casebook

- The Casebook's lists (case types, stages, roles, evidence types, checklist items, places) are at the top of `casebook/js/model.js`. Settings such as the backup reminder and the shortest allowed passphrase are in `CONFIG` at the top of `casebook/js/app.js`, and the investigation guide's text is in `viewGuide()` in the same file.
- After changing files in `casebook/`, also change the version in `casebook/sw.js` (`megafauna-casebook-v1` → `megafauna-casebook-v2`) so installed copies update.
- The tests for the encryption, the Casebook file format, combining and the activity log need Node.js 20 or later and nothing else. Run `node --test` from the top of the repository.
- The fonts (DM Sans and Fraunces) are served from `casebook/fonts/` under the SIL Open Font License; the licences are in the same folder.

## Sources for the facts on the site

The programme details come from the foundation's public listings (Give.do and company registry entries, CIN U85500PB2024NPL061864). Please review all text, especially the figures and the "Know the law" section, and keep it up to date. In detail:

- **Give.do profile** ([give.do/ngos/megafauna-welfare-foundation](https://give.do/ngos/megafauna-welfare-foundation)): the five projects; 1,000+ animals fed every day across the Tricity and neighbouring areas, including hard-to-reach spots; the veterinary team's work in flood-hit areas including Sultanpur Lodhi; 12 active legal cases; sensitisation sessions for schools, colleges, residential areas and public servants; the sanctuary in development about an hour from Chandigarh; the appeal for goats and sheep at Bakri Mandi; and 80G eligibility for donations.
- **Company registry listings:** incorporated on 21 June 2024; registered office in Mullanpur, Mohali, Punjab.
- **News items:** The Tribune's reports on the High Court notice on the foundation's SPCA petition and on the PEC campus dogs, and ThePrint's report on the Animal Birth Control Rules panel at the Press Club of India. Each item on `news.html` links to its report.
- **Internships:** the foundation's page on Internshala.

The website's emergency steps, first-aid advice and tips for feeders are the same as the Care app's Guide, and the "Know the law" page follows the app and the Casebook's investigation guide, so change them together.

The app's first-aid advice is general guidance for people without veterinary training, and its legal text is general information, not legal advice. It's worth asking a vet and a lawyer you work with to read the app's Guide before you promote it widely.

The Casebook's investigation guide summarises section 325 of the Bharatiya Nyaya Sanhita, 2023, section 11 of the Prevention of Cruelty to Animals Act, 1960, sections 173 and 175(3) of the Bharatiya Nagarik Suraksha Sanhita, 2023, the Animal Birth Control Rules, 2023, and section 63(4) of the Bharatiya Sakshya Adhiniyam, 2023. It is general information for volunteers, not legal advice; ask the lawyers you work with to read it before the team relies on it.
