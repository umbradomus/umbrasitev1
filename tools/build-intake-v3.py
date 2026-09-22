#!/usr/bin/env python3
"""INTAKE v3 — regenerates the wizard block in services.html and es/servicios.html
from one string table, so both pages have the same screens in the same order.

Run from the repo root:  python3 tools/build-intake-v3.py
Replaces everything between  <div class="intake2" data-intake2>  and the
closing  </form>  on each page. Field NAMES are unchanged (spec §6).
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]

CAM_SVG = ('<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" '
           'stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5h3.2l1.4-2h8.8l1.4 2H21a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z"/>'
           '<circle cx="12" cy="13.5" r="3.6"/></svg>')
LIB_SVG = ('<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" '
           'stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="1.6"/>'
           '<path d="M3 15.5l4.5-4.2 4 3.6 3.4-3 6.1 5.1"/><circle cx="8.3" cy="9.3" r="1.3"/></svg>')

# value -> (EN label, ES label). Values are what the Worker and the FC read; they stay English.
L = {
    'Holes': ('Holes', 'Hoyos'), 'Cracks': ('Cracks', 'Grietas'), 'Water stain': ('Water stain', 'Mancha de agua o humedad'),
    'A patch that shows': ('A patch that shows', 'Un resane que se nota'), 'Just paint': ('Just paint', 'Solo pintura'),
    'Something else': ('Something else', 'Otra cosa'),
    'Ceiling': ('Ceiling', 'Techo'), 'Walls': ('Walls', 'Paredes'), 'Corner or edge': ('Corner or edge', 'Esquina u orilla'),
    'Door or window': ('Door or window', 'Puerta o ventana'),
    '1–5': ('1–5', '1–5'), '6–15': ('6–15', '6–15'), '16–30': ('16–30', '16–30'), '30+': ('30+', 'Más de 30'),
    'Not sure': ('Not sure', 'No sé'),
    'Pinhole': ('Pinhole', 'De clavo'), 'Coin': ('Coin', 'Como un quarter'), 'Golf ball': ('Golf ball', 'Pelota de golf'),
    'Fist': ('Fist', 'Un puño'), 'Basketball': ('Basketball', 'Balón de básquetbol'),
    'Nothing': ('Nothing', 'Nada'), 'Screws or nails': ('Screws or nails', 'Tornillos o clavos'), 'Plastic anchors': ('Plastic anchors', 'Taquetes'),
    'Smooth': ('Smooth', 'Lisa'), 'Orange peel': ('Orange peel', 'Cáscara de naranja'), 'Knockdown': ('Knockdown', 'Knockdown'),
    'Popcorn': ('Popcorn', 'Tirol'),
    'Yes': ('Yes', 'Sí'), 'No': ('No', 'No'),
}
T = {
    'photo.q': ('Show us the problem areas', 'Muéstrenos las áreas con problema'),
    'photo.hint': ('Photos help us quote accurately &mdash; the more, the better', 'Las fotos nos ayudan a cotizar bien &mdash; entre más, mejor'),
    'photo.add': ('Add photos', 'Agregar fotos'), 'photo.take': ('Take a photo', 'Tomar una foto'),
    'multi': ('Select all that apply', 'Seleccione todas las que apliquen'),
    'need1': ('Please select at least one', 'Seleccione por lo menos una'),
    'what.q': ('What is the issue?', '¿Cuál es el problema?'), 'where.q': ('Where is the issue?', '¿Dónde está el problema?'),
    'ceiling': ('Ceiling', 'Techo'), 'walls': ('Walls', 'Paredes'),
    'count.q': ('How many areas need repair?', '¿Cuántas áreas necesitan reparación?'), 'size.q': ('How large is the biggest one?', '¿De qué tamaño es la más grande?'),
    'left.q': ('Is anything still in the holes?', '¿Queda algo dentro de los hoyos?'), 'tex.q': ('What is the surface texture?', '¿Qué textura tiene la superficie?'),
    'paint.q': ('Do you have leftover paint on hand?', '¿Tiene pintura sobrante a la mano?'),
    'name.q': ('Your name', 'Su nombre'), 'phone.q': ('Phone', 'Teléfono'), 'addr.q': ('Address', 'Dirección'),
    'notes.q': ('Anything else we should know?', '¿Algo más que debamos saber?'), 'opt': ('Optional', 'Opcional'),
    'send.q': ('Ready to send?', '¿Listo para enviar?'),
    'send.hint': ('We reply within 2 hours, 7am&ndash;9pm, seven days a week.', 'Respondemos en menos de 2 horas, de 7am a 9pm, los siete días.'),
    'back': ('Back', 'Atrás'), 'next': ('Next', 'Siguiente'), 'send': ('Send', 'Enviar'),
}
TEX_IMG = {'Smooth': 'tex-smooth', 'Orange peel': 'tex-orange-peel', 'Knockdown': 'tex-knockdown', 'Popcorn': 'tex-popcorn', 'Not sure': 'tex-unsure'}


def build(lang):
    i = 0 if lang == 'en' else 1
    t = lambda k: T[k][i]
    lab = lambda v: L[v][i]

    def opts(name, values, kind, extra_cls='', last=None, tex=False):
        rows = []
        for v in values:
            img = (f'<img src="/assets/img/{TEX_IMG[v]}.svg?v=1" alt="" width="64" height="64" loading="lazy" decoding="async">' if tex else '')
            cls = ' class="v2last"' if v == last else ''
            rows.append(f'            <li{cls}><label class="v2opt v2{kind}"><input type="{kind}" name="{name}" value="{v}"><i class="v2mark" aria-hidden="true"></i>{img}<span>{lab(v)}</span></label></li>')
        return f'          <ul class="v2opts{(" " + extra_cls) if extra_cls else ""}">\n' + '\n'.join(rows) + '\n          </ul>'

    def surface(key, s):   # s = 'ceiling' | 'walls'
        eyebrow = f'          <p class="v2where" data-surface="{s}"><span>{t(s)}</span></p>'
        return eyebrow

    out = []
    a = out.append
    a('<div class="intake2" data-intake2>')
    a('          <div class="v2bar" aria-hidden="true"><i data-v2fill></i></div>')
    # 1 photos
    a('        <section class="fstep" data-fstep="photos" hidden>')
    a(f'          <p class="v2q">{t("photo.q")}</p>')
    a(f'          <p class="v2hint">{t("photo.hint")}</p>')
    a(f'          <label class="v2file"><span class="v2sr">{t("photo.add")}</span><input class="field file" type="file" name="attachment" accept="image/*" multiple data-photo-input></label>')
    a('          <div class="photo-actions" data-photo-buttons hidden>')
    a(f'            <button class="btn ghost v2cam" type="button" data-photo-camera aria-label="{t("photo.take")}">{CAM_SVG}</button>')
    a(f'            <button class="btn ghost" type="button" data-photo-library>{LIB_SVG}{t("photo.add")}</button>')
    a('          </div>')
    a('          <input type="file" accept="image/*" capture="environment" data-photo-capture hidden aria-hidden="true" tabindex="-1" style="display:none">')
    a(f'          <ul class="pix" data-photo-list aria-label="{t("photo.add")}" hidden></ul>')
    a('        </section>')
    # 2 what
    a('        <section class="fstep" data-fstep="what" data-need="1" hidden>')
    a(f'          <p class="v2q">{t("what.q")}</p>')
    a(f'          <p class="v2hint">{t("multi")}</p>')
    a(opts('problem', ['Holes', 'Cracks', 'Water stain', 'A patch that shows', 'Just paint', 'Something else'], 'checkbox', last='Something else'))
    a(f'          <p class="v2need" role="alert" hidden>{t("need1")}</p>')
    a('        </section>')
    # 3 where
    a('        <section class="fstep" data-fstep="where" data-need="1" hidden>')
    a(f'          <p class="v2q">{t("where.q")}</p>')
    a(f'          <p class="v2hint">{t("multi")}</p>')
    a(opts('problem_area', ['Ceiling', 'Walls', 'Corner or edge', 'Door or window'], 'checkbox'))
    a(f'          <p class="v2need" role="alert" hidden>{t("need1")}</p>')
    a('        </section>')
    # per-surface blocks
    for s, pre in (('ceiling', 'ceiling'), ('walls', 'walls')):
        a(f'        <section class="fstep" data-fstep="{s}-count" data-surface="{s}" hidden>')
        a(surface('count', s))
        a(f'          <p class="v2q">{t("count.q")}</p>')
        a(opts(f'{pre}_count_band', ['1–5', '6–15', '16–30', '30+', 'Not sure'], 'radio'))
        a('        </section>')
        a(f'        <section class="fstep" data-fstep="{s}-size" data-surface="{s}" hidden>')
        a(surface('size', s))
        a(f'          <p class="v2q">{t("size.q")}</p>')
        a(opts(f'{pre}_biggest', ['Pinhole', 'Coin', 'Golf ball', 'Fist', 'Basketball'], 'radio'))
        a('        </section>')
        a(f'        <section class="fstep" data-fstep="{s}-left" data-surface="{s}" hidden>')
        a(surface('left', s))
        a(f'          <p class="v2q">{t("left.q")}</p>')
        a(f'          <p class="v2hint">{t("multi")}</p>')
        a(opts(f'{pre}_condition', ['Nothing', 'Screws or nails', 'Plastic anchors', 'Not sure'], 'checkbox'))
        a('        </section>')
        a(f'        <section class="fstep" data-fstep="{s}-tex" data-surface="{s}" hidden>')
        a(surface('tex', s))
        a(f'          <p class="v2q">{t("tex.q")}</p>')
        a(opts(f'{pre}_surface', ['Smooth', 'Orange peel', 'Knockdown', 'Popcorn', 'Not sure'], 'radio', extra_cls='v2tex', tex=True))
        a('        </section>')
    # paint
    a('        <section class="fstep" data-fstep="paint" hidden>')
    a(f'          <p class="v2q">{t("paint.q")}</p>')
    a(opts('paint_on_site', ['Yes', 'No', 'Not sure'], 'radio'))
    a('        </section>')
    # you
    a('        <section class="fstep" data-fstep="name" hidden>')
    a(f'          <label class="v2field"><span class="v2q">{t("name.q")}</span><input class="field" type="text" name="name" autocomplete="name" required enterkeyhint="next"></label>')
    a('        </section>')
    a('        <section class="fstep" data-fstep="phone" hidden>')
    a(f'          <label class="v2field"><span class="v2q">{t("phone.q")}</span><input class="field" type="tel" name="phone" autocomplete="tel" inputmode="tel" required enterkeyhint="next"></label>')
    a('        </section>')
    a('        <section class="fstep" data-fstep="address" hidden>')
    a(f'          <label class="v2field"><span class="v2q">{t("addr.q")}</span><input class="field" type="text" name="address" autocomplete="street-address" enterkeyhint="next"></label>')
    a('        </section>')
    a('        <section class="fstep" data-fstep="notes" hidden>')
    a(f'          <label class="v2field"><span class="v2q">{t("notes.q")}</span><span class="v2hint">{t("opt")}</span><textarea class="field" name="what" rows="4"></textarea></label>')
    a('        </section>')
    a('        <section class="fstep" data-fstep="send" hidden>')
    a(f'          <p class="v2q">{t("send.q")}</p>')
    a(f'          <p class="v2hint">{t("send.hint")}</p>')
    a('        </section>')
    # nav: Back · Next, and Send in Next's place on the last screen
    a('          <div class="v2nav">')
    a(f'            <button class="btn ghost v2back" type="button" data-v2back>{t("back")}</button>')
    a(f'            <button class="btn v2next" type="button" data-v2next>{t("next")}</button>')
    a(f'            <button class="btn v2send" type="submit" data-v2send hidden>{t("send")}</button>')
    a('          </div>')
    a('        </div>')
    return '\n'.join(out)


def patch(page, lang):
    p = ROOT / page
    s = p.read_text(encoding='utf-8')
    m = re.search(r'<div class="intake2" data-intake2>.*?\n        </div>\n      </form>', s, re.S)
    if not m:
        sys.exit(f'{page}: wizard block not found')
    s = s[:m.start()] + build(lang) + '\n      </form>' + s[m.end():]
    s = re.sub(r'/assets/umbra-intake-v2\.js\?v=\d+', '/assets/umbra-intake-v2.js?v=4', s)
    p.write_text(s, encoding='utf-8')
    print(page, 'ok')


patch('services.html', 'en')
patch('es/servicios.html', 'es')

# THE STYLESHEET VERSION TAG. Vercel serves /assets/site.css with a 7-day cache
# and the pages linked it with no version, so a phone kept yesterday's rules under
# today's HTML (measured on Drew's phone 2026-09-22). Every page now asks for
# site.css?v=N; bump CSS_V whenever site.css changes.
CSS_V = 3
for page in list(ROOT.glob('*.html')) + list(ROOT.glob('es/*.html')):
    h = page.read_text(encoding='utf-8')
    h2 = re.sub(r'/assets/site\.css(\?v=\d+)?', f'/assets/site.css?v={CSS_V}', h)
    if h2 != h:
        page.write_text(h2, encoding='utf-8')
        print('css tag', page.relative_to(ROOT))
