#!/usr/bin/env python3
"""Build Adjust Me into ONE self-contained HTML file: builds/adjust-me/Adjust Me.html

    python3 source/adjust-me/tools/build_single_file.py

Everything the page needs (app code, styles, fflate for .docx zips, PDF.js for reading PDFs) is
copied inside the file, so it runs with no internet. Nothing is downloaded at build time either:
the libraries live in source/adjust-me/vendor/.
"""
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent.parent
REPO = HERE.parent.parent
OUT = REPO / "builds" / "adjust-me" / "Adjust Me.html"
VERSION = "1.0.0"


def js(path, banner):
    text = (HERE / path).read_text(encoding="utf-8")
    # Never let library text close the <script> element early, and drop source-map hints.
    text = re.sub(r"</(script)", r"<\\/\1", text, flags=re.I)
    text = re.sub(r"^//# sourceMappingURL=.*$", "", text, flags=re.M)
    return "/* " + banner + " */\n" + text


def main():
    page = (HERE / "src" / "index.html").read_text(encoding="utf-8")
    parts = {
        "/*__APP_CSS__*/": (HERE / "src" / "app.css").read_text(encoding="utf-8"),
        "/*__FFLATE__*/": js("vendor/fflate.min.js", "fflate 0.8.2, MIT licence, (c) 2023 Arjun Barrett. Used to read and write .docx (zip) files."),
        "/*__PDFJS_WORKER__*/": js("vendor/pdf.worker.min.js", "PDF.js 3.11.174 (worker, run on the page), Apache-2.0 licence, Mozilla Foundation. Used to read text from PDFs."),
        "/*__PDFJS__*/": js("vendor/pdf.min.js", "PDF.js 3.11.174, Apache-2.0 licence, Mozilla Foundation."),
        "/*__APP_JS__*/": js("src/app.js", "Adjust Me " + VERSION + " (Generate4U)"),
    }
    for key, value in parts.items():
        if page.count(key) != 1:
            sys.exit("placeholder %s missing from src/index.html" % key)
        page = page.replace(key, value)
    page = page.replace("__VERSION__", VERSION)
    if re.search(r"""(src|href)\s*=\s*["']?(https?:)?//""", re.sub(r"<script\b[^>]*>.*?</script>", "", page, flags=re.S | re.I)):
        sys.exit("the page points at another website; it must be fully offline")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(page, encoding="utf-8")
    print("wrote %s (%.1f MB)" % (OUT.relative_to(REPO), OUT.stat().st_size / 1e6))


if __name__ == "__main__":
    main()
