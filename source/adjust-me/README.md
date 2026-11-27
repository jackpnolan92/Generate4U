# Adjust Me

Part of Generate4U. A teacher loads a worksheet, ticks the adjustments from a student's Disability
Inclusion Profile (DIP), and downloads an adjusted copy as an editable Word file, or prints / saves it as PDF.

**Offline rule:** everything runs inside one HTML file. No internet, no CDN, no cloud or AI service. The page's
Content-Security-Policy blocks every network connection. The document is never saved; only the adjustment
choices are remembered (`localStorage` key `adjust-me-settings`, cleared by "Forget saved choices").

## What it reads
- **Word (.docx)**: headings, paragraphs, bold/italic/underline, bulleted and numbered lists, pictures, tables, text boxes.
- **PDF**: the text only (headings guessed from font size, bullets and numbered questions recognised). Pictures and
  table layouts in a PDF don't come across. Scanned PDFs (photos of pages) can't be read: OCR isn't included.
- **Google Docs**: download as .docx first (File, Download, Microsoft Word). Links can't be opened offline.

## Adjustments
| Group | Adjustment | How |
|---|---|---|
| Text and layout | Font, size, line spacing, letter and word spacing, page colour, italics/underline to bold, name and date line, page numbers | Restyles the whole document |
| Language and reading | Simpler words and shorter sentences | ~190 plain-English word and phrase swaps, semicolons and very long sentences split. Fixed rules, not AI; changes are highlighted in the preview |
| | Bold instruction words | Explain, describe, circle, not, ... |
| | Key words box | Typed by the teacher; "Suggest" lists long subject words from the document |
| Chunking | Two sentences per chunk / one sentence per line, a box around each question, one question per page, tick boxes | Rule based |
| Questions | Reduce the number of questions | Numbered questions are detected; keep all, first half, every second one, or pick; renumbers |
| Writing | Extra space after each question | Ruled lines or a blank box, 3 to 12 lines, three line heights |
| Visual supports | Picture cues for instructions, picture size (keep, bigger, full width, remove) | Emoji cue chosen from the first word (read, write, draw, calculate ...) |

## Not possible offline (shown in the app)
AI rewriting or summarising, generating new pictures, translation, built-in read aloud (some voices go online),
OCR of scanned PDFs, opening Google Docs links, and pictures/tables from PDFs.

## Build
```
python3 source/adjust-me/tools/build_single_file.py   # writes builds/adjust-me/Adjust Me.html
```
`src/` holds the page, styles and code. `vendor/` holds the two libraries that get copied into the file:
fflate 0.8.2 (MIT, reads and writes the .docx zip) and PDF.js 3.11.174 legacy build (Apache-2.0, reads PDF text;
run on the page, no worker, with `isEvalSupported: false`). Licences are next to them.

To add it to the Generate4U website, copy the built file to the website's `builds/adjust-me/` and keep the
`adjust-me` entry in `apps.json`.
