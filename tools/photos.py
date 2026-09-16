"""
HOW TO RUN THIS

1. Drop the phone photos for one job into assets/img/work/<job-slug>/ — for job UD-26-0001
   that folder is assets/img/work/ud-26-0001/.
2. Name them before-1.jpg, before-2.jpg, during-1.jpg, after-1.jpg and so on. The name tells
   the web page which strip the photo belongs in. Anything else lands in "During".
3. If Pillow is not installed yet, run once:  pip install pillow --break-system-packages
4. Then run, from the folder that holds this website:
       python tools/photos.py assets/img/work/ud-26-0001/
5. It reads every photo in that folder and writes three web-sized copies of each one beside
   it, plus a smaller .webp of each size. Your originals are never changed or overwritten.
6. It strips the location, the date, the camera and everything else the phone hides inside
   the file. That is the point: a phone photo carries the house's GPS coordinates.
7. It prints one line per photo and writes manifest.json in the same folder. The page builder
   (tools/build-work.py) reads that file.
8. It works on any folder, not just a job folder. For the portrait on the About page, put
   drew.jpg in assets/img/ and run:  python tools/photos.py assets/img/
   That gives you assets/img/drew-640.jpg and assets/img/drew-640.webp, which is what the
   About page is already written to use.
9. iPhone .HEIC files need one extra package: pip install pillow-heif --break-system-packages
   Without it the script tells you to export the photos as JPEG from the phone instead.
10. Run it again any time. It re-makes the web copies from the originals and skips its own
    output, so running it twice does no harm.
"""

import json
import os
import sys

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.stderr.write(
        "Pillow is not installed.\n"
        "Run this first, then try again:\n"
        "    pip install pillow --break-system-packages\n"
    )
    raise SystemExit(1)

# Long edge of each web copy, in pixels. 640 goes in the photo strips, 1045 opens when you
# tap one, 1600 is the spare for anything bigger later.
SIZES = (640, 1045, 1600)
JPEG_QUALITY = 82
WEBP_QUALITY = 80

SOURCE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".heic")
OUTPUT_SUFFIXES = tuple("-%d" % s for s in SIZES)

_heif_ready = None


def heif_available():
    """Register pillow-heif once, if it is installed. Returns True when HEIC can be read."""
    global _heif_ready
    if _heif_ready is None:
        try:
            import pillow_heif

            pillow_heif.register_heif_opener()
            _heif_ready = True
        except ImportError:
            _heif_ready = False
    return _heif_ready


def is_source(name):
    """True for a photo we should process, False for our own output and for everything else."""
    stem, ext = os.path.splitext(name)
    if ext.lower() not in SOURCE_EXTENSIONS:
        return False
    if stem.endswith(OUTPUT_SUFFIXES):
        return False
    return True


def kb(path):
    return int(round(os.path.getsize(path) / 1024.0))


def stripped_copy(img):
    """A new image holding only pixels: no EXIF, no GPS, no ICC profile, no comment.

    Pillow carries metadata along in img.info, so the only reliable way to drop all of it is
    to build a fresh image and paste the pixels in. The pixels are treated as sRGB, which is
    what every phone camera writes.
    """
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    clean = Image.new(img.mode, img.size)
    clean.paste(img)
    return clean


def resized(img, long_edge):
    """The image scaled so its long edge is long_edge. Never scaled up past the original."""
    w, h = img.size
    longest = max(w, h)
    if longest <= long_edge:
        return img.copy()
    scale = float(long_edge) / float(longest)
    return img.resize((max(1, int(round(w * scale))), max(1, int(round(h * scale)))), Image.LANCZOS)


def process(folder, name):
    """Write the web copies of one photo. Returns its manifest entry, or None if it was skipped."""
    source = os.path.join(folder, name)
    stem, ext = os.path.splitext(name)

    if ext.lower() == ".heic" and not heif_available():
        print(
            "  SKIPPED %s — this is an iPhone HEIC file and Python cannot open it here.\n"
            "          Either run:  pip install pillow-heif --break-system-packages\n"
            "          or, on the phone, export the photo as JPEG and drop that in instead.\n"
            "          (iPhone: Settings > Camera > Formats > Most Compatible makes every new\n"
            "          photo a JPEG from then on.)" % name
        )
        return None

    try:
        with Image.open(source) as opened:
            opened.load()
            clean = stripped_copy(opened)
    except OSError as err:
        print("  SKIPPED %s — could not read it (%s)." % (name, err))
        return None

    width, height = clean.size
    outputs = []
    reported = []

    for long_edge in SIZES:
        small = resized(clean, long_edge)

        jpg_name = "%s-%d.jpg" % (stem, long_edge)
        jpg_path = os.path.join(folder, jpg_name)
        if os.path.abspath(jpg_path) == os.path.abspath(source):
            print("  SKIPPED %s — writing it would overwrite the original." % jpg_name)
            continue
        out = small if small.mode == "RGB" else small.convert("RGB")
        out.save(jpg_path, "JPEG", quality=JPEG_QUALITY, progressive=True, optimize=True)

        webp_name = "%s-%d.webp" % (stem, long_edge)
        webp_path = os.path.join(folder, webp_name)
        if os.path.abspath(webp_path) == os.path.abspath(source):
            print("  SKIPPED %s — writing it would overwrite the original." % webp_name)
            continue
        out.save(webp_path, "WEBP", quality=WEBP_QUALITY, method=6)

        outputs.append(jpg_name)
        outputs.append(webp_name)
        reported.append(
            "%dpx %dKB jpg / %dKB webp" % (long_edge, kb(jpg_path), kb(webp_path))
        )

    print("  %s — %d x %d — %s" % (name, width, height, "; ".join(reported)))
    return {"name": name, "w": width, "h": height, "outputs": outputs}


def main(argv):
    if len(argv) != 2:
        sys.stderr.write(
            "Usage: python tools/photos.py assets/img/work/<job-slug>/\n"
            "It also works on any other folder, for example: python tools/photos.py assets/img/\n"
        )
        return 2

    folder = os.path.normpath(os.path.abspath(argv[1]))
    if not os.path.isdir(folder):
        sys.stderr.write("That is not a folder: %s\n" % folder)
        return 1

    names = sorted(
        (n for n in os.listdir(folder) if is_source(n) and os.path.isfile(os.path.join(folder, n))),
        key=lambda n: n.lower(),
    )

    print("Folder: %s" % folder)
    if not names:
        print("No photos to do. Drop .jpg, .jpeg, .png or .heic files in there and run this again.")
        return 0

    print("%d photo%s to do." % (len(names), "" if len(names) == 1 else "s"))
    entries = []
    for name in names:
        entry = process(folder, name)
        if entry:
            entries.append(entry)

    manifest_path = os.path.join(folder, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(entries, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    print("Wrote %s — %d photo%s listed." % (manifest_path, len(entries), "" if len(entries) == 1 else "s"))
    print("Next: python tools/build-work.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
