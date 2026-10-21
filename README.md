# Pawgarh Veterinarski Private Limited website

The website of **Pawgarh Veterinarski Private Limited**, the parent company of three pet-care brands: **Pet Smile**, **Pet Matters** and **Pet Pulse**.

Address once published from this repository with GitHub Pages: <https://megafaunawelfare.github.io/github-pages/>

## What's here

```
index.html               The whole site (one page, in sections)
404.html                 "Page not found" page (self-contained)
assets/css/styles.css    Styles: colours and fonts are set at the top in :root
assets/js/main.js        Mobile menu, scroll effects, contact form
assets/img/logo.svg      Pawgarh crest, also used as the browser icon
assets/img/og-image.png  Preview image shown when the link is shared (1200 x 630)
.nojekyll                Tells GitHub Pages to serve the files as they are
```

The site is plain HTML, CSS and JavaScript, so there's no build step and nothing to install.

## Publishing with GitHub Pages

1. In the repository, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to *Deploy from a branch*.
3. Choose the branch that holds these files (or `main`, once they're merged into it) and `/ (root)`, then **Save**.
4. After a minute or two the site is live at the address above.

A repository has only one GitHub Pages site. If this repository is already publishing a different site, switching the branch replaces it. To keep both online, put this website in its own repository.

## Editing the content

All text is in `index.html`, grouped by section (`<!-- About -->`, `<!-- Our brands -->`, and so on). Open the file on GitHub, click the pencil icon, edit, and commit. The site updates automatically.

Brand colours are at the top of `assets/css/styles.css` (`--smile`, `--matters`, `--pulse` and their `-ink` and `-tint` versions). Pawgarh's own colours are `--indigo`, `--paper` and `--stone`.

### Before launch

Search `index.html` for `TODO` to find each of these:

- **Company details:** the email address (`contact@example.com`, in the contact list and in the form's `data-email`), phone number, registered office address, Corporate Identity Number (CIN) and the name of the person to contact for queries or grievances. Indian company law (Rule 26 of the Companies (Incorporation) Rules, 2014) expects a company's website to show all of these on its home page. Until they're filled in, the page shows "To be added".
- **Brand descriptions:** the text for Pet Smile, Pet Matters and Pet Pulse is a first draft based on the brand names. Replace it with what each brand actually offers.
- **"What's in a name?":** the card in the About section explains *Pawgarh* as *paw* + *garh* (fort). Change or remove it if the name means something else to you.
- **Brand logos and links:** if the brands have their own logos, websites or social media pages, add the logos to `assets/img/` and point each brand's "Ask about…" link at its own page.

### Using a custom domain

If you move to your own domain (for example `www.yourdomain.in`), set it under **Settings → Pages → Custom domain**, then replace `https://megafaunawelfare.github.io/github-pages/` with the new address in `index.html`. It appears in the `og:` link-preview tags and in the search-engine block near the top of the file.
