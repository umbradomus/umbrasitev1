"""
HOW TO RUN THIS

1. First run tools/photos.py on the job folder. This script reads the manifest.json that
   photos.py writes, so nothing happens until that file exists.
2. Then, from the folder that holds this website:
       python tools/build-work.py
   It fills the photo strips on work.html from the photos in assets/img/work/ud-26-0001/.
   A photo named before-*.jpg goes in Before, during-*.jpg in During, after-*.jpg in After.
   Anything named something else goes in During.
3. Look at the page, then, when you are happy with it, publish it:
       python tools/build-work.py --publish
   That adds Work to the navigation on every page, adds /work to sitemap.xml, and takes the
   noindex line off work.html so search engines are allowed to see it.
4. Another job later: python tools/build-work.py --job ud-26-0002 (after you add that card
   and its markers to work.html).
5. Both commands can be run twice. Running them again changes nothing that is already right.
"""

import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

DEFAULT_JOB = "ud-26-0001"
# what the alt text says the job was, per job slug
JOB_WORK = {"ud-26-0001": "drywall and ceiling patch"}

GROUPS = ("BEFORE", "DURING", "AFTER")
GROUP_WORDS = {"BEFORE": "Before", "DURING": "During", "AFTER": "After"}
EMPTY_LINE = '<p class="strip-empty">Photos coming — the job is done, the pictures are being sorted.</p>'

STRIP_EDGE = 640      # the size shown in the strip
TAP_EDGE = 1045       # the size that opens when you tap one

NAV_EN = '      <a href="/work">Work</a>'
NAV_ES = '      <a href="/work" hreflang="en">Trabajos (en inglés)</a>'
SITEMAP_LINE = "  <url><loc>https://www.umbradomus.com/work</loc></url>"


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def write(path, text):
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def natural_key(name):
    """Sort before-2 ahead of before-10, the way a person would."""
    return [int(p) if p.isdigit() else p.lower() for p in re.split(r"(\d+)", name)]


def group_of(name):
    lowered = name.lower()
    if lowered.startswith("before-"):
        return "BEFORE"
    if lowered.startswith("after-"):
        return "AFTER"
    return "DURING"


def scaled(w, h, long_edge):
    """The size of the web copy photos.py made at this long edge. It never scales up."""
    longest = max(w, h)
    if longest <= long_edge:
        return w, h
    scale = float(long_edge) / float(longest)
    return max(1, int(round(w * scale))), max(1, int(round(h * scale)))


def figure_html(job, entry, group, index, count, indent):
    stem = os.path.splitext(entry["name"])[0]
    base = "/assets/img/work/%s/%s" % (job, stem)
    w, h = scaled(int(entry["w"]), int(entry["h"]), STRIP_EDGE)
    work = JOB_WORK.get(job, "the job")
    alt = "%s the work: %s. Photo %d." % (GROUP_WORDS[group], work, index)
    caption = "%s, photo %d of %d." % (GROUP_WORDS[group], index, count)
    pad = " " * indent
    return "\n".join([
        pad + '<figure class="shot">',
        pad + '  <a href="%s-%d.jpg">' % (base, TAP_EDGE),
        pad + "    <picture>",
        pad + '      <source type="image/webp" srcset="%s-%d.webp">' % (base, STRIP_EDGE),
        pad + '      <img src="%s-%d.jpg" width="%d" height="%d" alt="%s" loading="lazy" decoding="async">'
        % (base, STRIP_EDGE, w, h, alt),
        pad + "    </picture>",
        pad + "  </a>",
        pad + "  <figcaption>%s</figcaption>" % caption,
        pad + "</figure>",
    ])


def fill(job):
    """Rewrite the three marker regions in work.html from the job folder's manifest.json."""
    folder = os.path.join(ROOT, "assets", "img", "work", job)
    manifest_path = os.path.join(folder, "manifest.json")
    if not os.path.isfile(manifest_path):
        sys.stderr.write(
            "No manifest at %s\n"
            "Drop the photos in that folder and run this first:\n"
            "    python tools/photos.py assets/img/work/%s/\n" % (manifest_path, job)
        )
        return 1

    with open(manifest_path, encoding="utf-8") as fh:
        entries = json.load(fh)

    buckets = {g: [] for g in GROUPS}
    for entry in entries:
        buckets[group_of(entry["name"])].append(entry)
    for g in GROUPS:
        buckets[g].sort(key=lambda e: natural_key(e["name"]))

    page_path = os.path.join(ROOT, "work.html")
    page = read(page_path)

    for group in GROUPS:
        open_marker = "<!-- JOB:%s:%s -->" % (job, group)
        if open_marker not in page:
            sys.stderr.write("work.html has no %s marker. Nothing filled.\n" % open_marker)
            return 1
        start = page.index(open_marker) + len(open_marker)
        end = page.index("<!-- /JOB -->", start)

        # keep the indentation the markers already sit at
        line_start = page.rfind("\n", 0, page.index(open_marker)) + 1
        indent = len(page[line_start:page.index(open_marker)])

        items = buckets[group]
        if items:
            body = "\n".join(
                figure_html(job, e, group, i + 1, len(items), indent)
                for i, e in enumerate(items)
            )
        else:
            body = " " * indent + EMPTY_LINE

        page = page[:start] + "\n" + body + "\n" + " " * indent + page[end:]
        print("%-6s %d photo%s" % (GROUP_WORDS[group], len(items), "" if len(items) == 1 else "s"))

    write(page_path, page)
    print("Filled work.html from %s" % manifest_path)
    total = sum(len(buckets[g]) for g in GROUPS)
    if total == 0:
        print("No photos found, so the strips still say the pictures are being sorted.")
    return 0


def nav_block(page):
    """The header navigation only — never the footer's list of the same links."""
    match = re.search(r'<nav class="menu"[^>]*>.*?</nav>', page, re.S)
    return match


def add_nav(path, spanish):
    """Put the Work link straight after the Services link in the header navigation.

    An English page's navigation also carries a link to /es/servicios (the Español item) and
    a Spanish page's carries one to /services (the English item), so which language a page is
    in has to come from where the file lives, not from what its links say.
    """
    page = read(path)
    match = nav_block(page)
    if not match:
        return "no header nav"
    block = match.group(0)
    if 'href="/work"' in block:
        return "already there"

    anchor = re.search(r'^[ \t]*<a href="/es/servicios".*?</a>[ \t]*$' if spanish
                       else r'^[ \t]*<a href="/services".*?</a>[ \t]*$', block, re.M)
    if not anchor:
        return "no Services link to sit after"

    new_item = NAV_ES if spanish else NAV_EN
    new_block = block[:anchor.end()] + "\n" + new_item + block[anchor.end():]
    write(path, page[:match.start()] + new_block + page[match.end():])
    return "added"


def unhide_work(path):
    page = read(path)
    changed = False
    if '<meta name="robots" content="noindex">' in page:
        page = page.replace('<meta name="robots" content="noindex">\n', "", 1)
        changed = True
    page, n = re.subn(r"<!-- UNLINK-UNTIL-PHOTOS:.*?-->\n", "", page, count=1, flags=re.S)
    changed = changed or bool(n)
    if changed:
        write(path, page)
    return changed


def add_sitemap(path):
    text = read(path)
    if "/work</loc>" in text:
        return "already there"
    match = re.search(r"^.*<loc>https://www\.umbradomus\.com/services</loc>.*$", text, re.M)
    if not match:
        return "no /services entry to sit after"
    write(path, text[:match.end()] + "\n" + SITEMAP_LINE + text[match.end():])
    return "added"


def publish():
    work_path = os.path.join(ROOT, "work.html")
    if EMPTY_LINE in read(work_path):
        print("Careful: at least one strip on work.html still has no photos in it.")
        print("Publishing anyway, because you asked. Run this without --publish first if that")
        print("was not what you meant.")

    pages = []  # (path, is a Spanish page)
    for name in sorted(os.listdir(ROOT)):
        if name.endswith(".html"):
            pages.append((os.path.join(ROOT, name), False))
    es_dir = os.path.join(ROOT, "es")
    if os.path.isdir(es_dir):
        for name in sorted(os.listdir(es_dir)):
            if name.endswith(".html"):
                pages.append((os.path.join(es_dir, name), True))

    for path, spanish in pages:
        print("%-28s %s" % (os.path.relpath(path, ROOT).replace("\\", "/"), add_nav(path, spanish)))

    print("%-28s %s" % ("sitemap.xml", add_sitemap(os.path.join(ROOT, "sitemap.xml"))))
    print("%-28s %s" % ("work.html noindex", "removed" if unhide_work(work_path) else "already off"))
    print("Done. Check it, commit it, push it.")
    return 0


def main(argv):
    parser = argparse.ArgumentParser(
        description="Fill the work page's photo strips, and publish the page when it is ready."
    )
    parser.add_argument("--job", default=DEFAULT_JOB, help="job folder slug (default %s)" % DEFAULT_JOB)
    parser.add_argument(
        "--publish",
        action="store_true",
        help="add Work to every page's navigation and to sitemap.xml, and take the noindex off work.html",
    )
    args = parser.parse_args(argv[1:])
    if args.publish:
        return publish()
    return fill(args.job)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
