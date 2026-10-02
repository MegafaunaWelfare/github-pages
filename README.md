# Megafauna Welfare Foundation website

The website of **Megafauna Welfare Foundation**, a Chandigarh-based non-profit that protects stray and neglected animals across the Chandigarh Tricity through daily feeding, emergency veterinary aid, legal aid and community sensitisation.

Live site (once GitHub Pages is enabled): <https://megafaunawelfare.github.io/github-pages/>

## What's here

```
index.html            The whole site (one page, in sections)
404.html              "Page not found" page (self-contained)
assets/css/styles.css Styles: colours and fonts are set at the top in :root
assets/js/main.js     Mobile menu, scroll effects, contact form
assets/img/logo.svg   Logo and browser icon
assets/img/og-image.png  Preview image shown when the link is shared
.nojekyll             Tells GitHub Pages to serve the files as they are
```

The site is plain HTML, CSS and JavaScript, so there's no build step and nothing to install.

## Publishing with GitHub Pages

1. Merge the changes into `main`.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*, choose `main` and `/ (root)`, then **Save**.
4. After a minute or two the site is live at the address above.

## Editing the content

All text is in `index.html`, grouped by section (`<!-- About -->`, `<!-- Our work -->`, and so on). Open the file on GitHub, click the pencil icon, edit, and commit. The site updates automatically.

### Before launch

- **Contact email:** replace `contact@example.org` in `index.html`. It appears twice: in the contact list and in the form's `data-email` attribute. Search the file for `TODO`.
- **Phone / WhatsApp / social media:** add them to the contact list in the `<!-- Contact -->` section if you'd like them shown.
- **Photos:** real photos of your work will make the site far more powerful. Add them to `assets/img/` and reference them from `index.html`.

### Using a custom domain

If you move to your own domain (for example `www.yourdomain.org`), set it under **Settings → Pages → Custom domain** and update the two `og:` URLs near the top of `index.html` so link previews keep working.

## Sources for the facts on the site

The programme details come from the foundation's public listings (Give.do and company registry entries, CIN U85500PB2024NPL061864). Please review all text, especially the figures and the "Know the law" section, and keep it up to date.
