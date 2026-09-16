# Job photos

One folder per job, named after the job number in lower case. Job UD-26-0001 lives in
`ud-26-0001/` — make that folder the first time you use it.

Name the photos so the page knows where to put them:

- `before-1.jpg`, `before-2.jpg`, … go in the **Before** strip
- `during-1.jpg`, `during-2.jpg`, … go in the **During** strip
- `after-1.jpg`, `after-2.jpg`, … go in the **After** strip

Anything named something else goes in **During**. Count from 1, in the order you want them
shown. `.jpeg`, `.png` and `.heic` work too.

Drop the originals in straight off the phone and leave them there. Then run, from the folder
that holds this website:

```
python tools/photos.py assets/img/work/ud-26-0001/
python tools/build-work.py
```

The first command makes the web-sized copies (`-640`, `-1045`, `-1600`, each as `.jpg` and
`.webp`) and strips the location, date and camera out of them — a phone photo carries the
house's GPS coordinates, and those must not go on the internet. The second fills in the page.
The full three steps are in `tools/publish-work.md`.

Never put a photo here that shows a house number, a face, or the inside of a home unless the
customer has said in writing that we can.
