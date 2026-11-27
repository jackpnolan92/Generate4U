#!/usr/bin/env python3
"""Build the IEP/BSP plan generator into ONE self-contained HTML file.

Developer source lives in source/plan-generator/ (index.html + fonts/ + src/).
Teachers and the Generate4U website get a single file with the fonts and the
session-progress script embedded, so it opens offline by double-clicking.

Usage (from the repository root):
    python3 source/plan-generator/tools/build_single_file.py

Output: builds/plan-generator/iep-generator.html
Standard library only. Fails loudly if the result could reach the network.
"""
import base64
import pathlib
import re
import sys

SRC = pathlib.Path(__file__).resolve().parent.parent
REPO = SRC.parent.parent
OUT = REPO / "builds" / "plan-generator" / "iep-generator.html"

SCRIPT_TAG = re.compile(r'<script\s+src="src/session-progress\.js"[^>]*>\s*</script>', re.S)
FONT_URL = re.compile(r"url\('(fonts/[A-Za-z0-9._-]+\.woff2)'\)")
CSP = re.compile(r'<meta http-equiv="Content-Security-Policy" content="[^"]*">', re.S)

SINGLE_FILE_CSP = (
    '<meta http-equiv="Content-Security-Policy" content="'
    "default-src 'none'; "
    "script-src 'unsafe-inline'; "
    "style-src 'unsafe-inline'; "
    "img-src data: blob:; "
    "font-src data:; "
    "connect-src 'none'; "
    "form-action 'none'; "
    "base-uri 'none'; "
    "object-src 'none'; "
    "frame-src 'none'\">"
)


def fail(msg):
    sys.exit("build_single_file: " + msg)


def main():
    html = (SRC / "index.html").read_text(encoding="utf-8")

    # 1. Fonts -> data: URIs
    def font(m):
        data = (SRC / m.group(1)).read_bytes()
        return "url(data:font/woff2;base64," + base64.b64encode(data).decode("ascii") + ")"
    html, n_fonts = FONT_URL.subn(font, html)
    if n_fonts == 0:
        fail("no bundled fonts found; has index.html changed?")

    # 2. session-progress.js -> inline <script>
    js = (SRC / "src" / "session-progress.js").read_text(encoding="utf-8")
    if "</script" in js.lower():
        fail("session-progress.js contains '</script' and cannot be inlined safely")
    html, n_scripts = SCRIPT_TAG.subn(lambda _m: "<script>\n" + js + "\n</script>", html)
    if n_scripts != 1:
        fail("expected exactly one session-progress.js <script> tag, found %d" % n_scripts)

    # 3. Tighter CSP: nothing but inline code and data:/blob: content
    html, n_csp = CSP.subn(SINGLE_FILE_CSP, html)
    if n_csp != 1:
        fail("expected exactly one Content-Security-Policy meta tag, found %d" % n_csp)

    # 4. Safety checks: no external files or web addresses left to load
    # (a src built in JavaScript, e.g. src="' + branding.logo + '", is a data: URI at run time)
    if re.search(r"""<(script|link|img|iframe)[^>]+(src|href)="(?!data:|#|' *\+)""", html, re.I):
        fail("an external src/href is still referenced")
    for url in set(re.findall(r'https?://[^\s"\'<>)]+', html)):
        if not url.startswith(("http://www.w3.org/", "https://www.w3.org/")):
            fail("web address left in output: " + url)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print("wrote %s (%d KB, %d fonts embedded)" % (OUT.relative_to(REPO), len(html.encode()) // 1024, n_fonts))


if __name__ == "__main__":
    main()
