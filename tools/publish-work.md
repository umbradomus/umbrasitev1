# Putting the first job on the website

The `/work` page is already built and already written. It is switched off: search engines are
told to ignore it, it is not in the sitemap, and no other page links to it. Three steps turn
it on. Do them in order.

You need the photos on this computer first, named `before-1.jpg`, `during-1.jpg`,
`after-1.jpg` and so on — count from 1 in the order you want them shown. Put them in
`assets/img/work/ud-26-0001/`; make that folder if it is not there yet. Anything named
something else lands in the During strip.

---

## Step 1 — make the web copies

```
python tools/photos.py assets/img/work/ud-26-0001/
```

This reads every photo in that folder and writes three sizes of each one beside it, as a
`.jpg` and a smaller `.webp`. Your originals are not touched.

It also strips the location, date and camera out of the copies. That is not optional: a phone
photo carries the GPS coordinates of the house it was taken at, and those must not go on the
internet.

It prints one line per photo and writes `manifest.json` in the same folder. If it says Pillow
is missing, run `pip install pillow --break-system-packages` and try again. If the photos are
iPhone `.HEIC` files it will tell you to either install `pillow-heif` or export them as JPEG
from the phone — either is fine.

## Step 2 — fill the page

```
python tools/build-work.py
```

This reads `manifest.json` and writes the photos into the Before, During and After strips on
`work.html`, between the `<!-- JOB:ud-26-0001:BEFORE -->` … `<!-- /JOB -->` markers.

Then open `work.html` in a browser and look at it. Two things to check by eye:

- No house number, no face, and no inside of a home that the customer has not said we can
  show. If one slipped in, delete that photo from the folder and run both commands again.
- The four paragraphs — What we found, What we did, The drying day, What it cost — say what
  actually happened. Fix any word that does not. The cost paragraph shows no number on
  purpose; the marker `<!-- PRICE: owner supplies -->` sits above it, and a number only goes
  in when you decide to show one.

## Step 3 — switch it on

```
python tools/build-work.py --publish
```

This does the three mechanical edits: adds **Work** to the navigation on every English page
(between Services and Automate) and **Trabajos (en inglés)** on the Spanish pages, adds
`/work` to `sitemap.xml`, and takes the `noindex` line off `work.html`.

Then commit and push:

```
git add -A
git commit -m "The first job on the work page"
git push
```

Give Vercel about ninety seconds, then open `https://umbradomus.com/work` and check the photos
load and the navigation shows Work on the other pages.

---

## Notes

- All three commands can be run twice. Running one again changes nothing that is already
  right.
- The same photo script works on any folder. For the portrait on the About page, put
  `drew.jpg` in `assets/img/` and run `python tools/photos.py assets/img/` — that produces
  `assets/img/drew-640.jpg` and `assets/img/drew-640.webp`, which is exactly what the
  commented block in `about.html` is waiting for.
- A second job later: add another `<article class="job">` card to `work.html` with markers
  named for that job, then `python tools/build-work.py --job ud-26-0002`.
- Nothing here deletes anything.
