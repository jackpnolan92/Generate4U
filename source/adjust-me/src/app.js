/* Adjust Me: makes an adjusted copy of a worksheet (Word or PDF) to match a student's
   Disability Inclusion Profile adjustments. Everything happens inside this page: no network, no AI service.
   Libraries used (inlined in the built file): fflate (zip, MIT) and PDF.js (PDF text, Apache-2.0). */
(function () {
  "use strict";

  var VERSION = "__VERSION__";
  var STORE_KEY = "adjust-me-settings";
  var W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  var R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  var EMU_PER_PX = 9525;
  var CONTENT_W_EMU = 170 * 36000; // A4 with 20 mm margins
  var $ = function (id) { return document.getElementById(id); };

  // ------------------------------------------------------------------ settings

  var DEFAULTS = {
    font: "Arial", size: 12, lineSpacing: 1.15, letterSpacing: 0, tint: "none", noItalic: false,
    nameLine: false, pageNumbers: true,
    simplify: false, boldVerbs: false, keywords: false, keywordText: "",
    chunk: "off", boxes: false, onePerPage: false, checklist: false,
    reduce: false, renumber: true,
    space: false, spaceLines: 5, spaceStyle: "lines", lineGap: "wide",
    icons: false, imgSize: "same", showChanges: true
  };
  var NOT_SAVED = { keywordText: true };

  var PRESETS = {
    dyslexia: { font: "Verdana", size: 14, lineSpacing: 1.5, letterSpacing: 0.05, tint: "cream", noItalic: true, boldVerbs: true, chunk: "pairs" },
    vision: { font: "Arial", size: 18, lineSpacing: 1.5, letterSpacing: 0.05, noItalic: true, imgSize: "full", boldVerbs: true, lineGap: "xwide" },
    reading: { font: "Arial", size: 14, lineSpacing: 1.5, simplify: true, boldVerbs: true, keywords: true, chunk: "sentence", icons: true },
    attention: { size: 14, lineSpacing: 1.5, chunk: "pairs", boxes: true, checklist: true, reduce: true, icons: true, boldVerbs: true, nameLine: true },
    writing: { size: 14, lineSpacing: 1.5, space: true, spaceLines: 8, spaceStyle: "lines", lineGap: "xwide", reduce: true }
  };

  var TINTS = { none: "#ffffff", cream: "#fdf6e3", yellow: "#fffbd6", blue: "#e8f1fb", green: "#eaf6ea", pink: "#fcecef", grey: "#f0f0f0" };
  var LINE_GAP_MM = { std: 8, wide: 10, xwide: 13 };

  var settings = loadSettings();
  var current = null; // { name, kind, blocks, questions, keep, images, warnings }

  function loadSettings() {
    var s = Object.assign({}, DEFAULTS);
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        Object.keys(DEFAULTS).forEach(function (k) {
          if (!NOT_SAVED[k] && saved && typeof saved[k] === typeof DEFAULTS[k]) s[k] = saved[k];
        });
      }
    } catch (e) { /* storage blocked: use defaults */ }
    return s;
  }
  function saveSettings() {
    try {
      var out = {};
      Object.keys(settings).forEach(function (k) { if (!NOT_SAVED[k]) out[k] = settings[k]; });
      window.localStorage.setItem(STORE_KEY, JSON.stringify(out));
    } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ small helpers

  function runsText(runs) { var t = ""; for (var i = 0; i < runs.length; i++) t += runs[i].text; return t; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function escXml(t) {
    return String(t).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function escHtml(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function wordCount(t) { var m = t.match(/[A-Za-z0-9’']+/g); return m ? m.length : 0; }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function bytesToBase64(u8) {
    var s = "", chunk = 0x8000;
    for (var i = 0; i < u8.length; i += chunk) s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    return btoa(s);
  }
  function base64ToBytes(b64) {
    var bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  // Remove the first n characters of a run list (used to lift "3." off a question).
  function stripPrefix(runs, n) {
    while (n > 0 && runs.length) {
      var r = runs[0];
      if (r.text.length <= n) { n -= r.text.length; runs.shift(); }
      else { r.text = r.text.slice(n); n = 0; }
    }
    if (runs.length) runs[0].text = runs[0].text.replace(/^\s+/, "");
  }
  function trimRuns(runs) {
    while (runs.length && !runs[0].text.replace(/^\s+/, "")) runs.shift();
    if (runs.length) runs[0].text = runs[0].text.replace(/^[ \t]+/, "");
    while (runs.length && !runs[runs.length - 1].text.replace(/\s+$/, "")) runs.pop();
    if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/[ \t]+$/, "");
    return runs;
  }
  // Split a run list at character offsets into several run lists.
  function splitRuns(runs, offsets) {
    var out = [], cur = [], pos = 0, oi = 0;
    runs.forEach(function (r) {
      var text = r.text, start = 0;
      while (oi < offsets.length && offsets[oi] <= pos + text.length) {
        var cut = offsets[oi] - pos;
        if (cut > start) cur.push(Object.assign({}, r, { text: text.slice(start, cut) }));
        out.push(cur); cur = []; start = cut; oi++;
      }
      if (start < text.length) cur.push(Object.assign({}, r, { text: text.slice(start) }));
      pos += text.length;
    });
    out.push(cur);
    return out.map(trimRuns).filter(function (rs) { return runsText(rs).trim(); });
  }

  // ------------------------------------------------------------------ sentence rules

  var ABBR = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|vs|etc|e\.g|i\.e|approx|no|No|fig|Fig|p|pp|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|ch|Ch|vol)|\b[A-Z])\.$/;
  function sentenceStarts(text) {
    var out = [], re = /[.!?]+["'”’)\]]*\s+(?=["'“‘(]?[A-Z0-9])/g, m;
    while ((m = re.exec(text))) {
      var endPunct = m.index + m[0].replace(/\s+$/, "").length;
      var before = text.slice(Math.max(0, m.index - 8), m.index + 1);
      if (m[0].charAt(0) === "." && ABBR.test(before)) continue;
      out.push(m.index + m[0].length);
      void endPunct;
    }
    return out;
  }

  // Plain-English swaps (based on common plain language guidance). Lower case keys.
  var SIMPLE = {
    "in order to": "to", "so as to": "to", "prior to": "before", "subsequent to": "after", "in addition": "also",
    "additionally": "also", "approximately": "about", "assist": "help", "assists": "helps", "assisted": "helped",
    "assistance": "help", "commence": "start", "commences": "starts", "commenced": "started", "commencement": "start",
    "comprehend": "understand", "demonstrate": "show", "demonstrates": "shows", "demonstrated": "showed",
    "determine": "work out", "endeavour": "try", "endeavor": "try", "ensure": "make sure", "facilitate": "help",
    "frequently": "often", "however": "but", "indicate": "show", "indicates": "shows", "individuals": "people",
    "initial": "first", "initially": "at first", "the majority of": "most", "majority": "most", "modify": "change",
    "modified": "changed", "numerous": "many", "obtain": "get", "obtained": "got", "occur": "happen", "occurs": "happens",
    "occurred": "happened", "occurring": "happening", "participate": "take part", "participated": "took part",
    "possess": "have", "possesses": "has", "previously": "before", "purchase": "buy", "purchased": "bought",
    "require": "need", "requires": "needs", "required": "needed", "reside": "live", "resides": "lives",
    "sufficient": "enough", "terminate": "end", "utilise": "use", "utilize": "use", "utilised": "used", "utilized": "used",
    "utilising": "using", "therefore": "so", "consequently": "so", "thus": "so", "hence": "so", "nevertheless": "but",
    "nonetheless": "but", "furthermore": "also", "moreover": "also", "regarding": "about", "concerning": "about",
    "with regard to": "about", "in relation to": "about", "attempt": "try", "attempts": "tries", "attempted": "tried",
    "a number of": "some", "a large number of": "many", "a great deal of": "a lot of", "at this point in time": "now",
    "at the present time": "now", "presently": "now", "currently": "now", "due to the fact that": "because",
    "owing to the fact that": "because", "in the event that": "if", "on a daily basis": "every day",
    "is able to": "can", "are able to": "can", "was able to": "could", "were able to": "could", "each and every": "each",
    "in the vicinity of": "near", "adjacent to": "next to", "additional": "extra", "alternatively": "or",
    "anticipate": "expect", "anticipated": "expected", "beneficial": "helpful", "capability": "ability",
    "cease": "stop", "ceased": "stopped", "component": "part", "components": "parts", "difficult": "hard",
    "eliminate": "remove", "eliminated": "removed", "encounter": "meet", "encountered": "met", "establish": "set up",
    "evident": "clear", "exhibit": "show", "exhibits": "shows", "expedite": "speed up", "fundamental": "basic",
    "identical": "the same", "immediately": "straight away", "enquire": "ask", "inquire": "ask", "objective": "aim",
    "portion": "part", "proceed": "go on", "provide": "give", "provides": "gives", "receive": "get", "receives": "gets",
    "received": "got", "remainder": "rest", "retain": "keep", "retained": "kept", "subsequently": "later",
    "substantial": "large", "transmit": "send", "upon": "on", "whilst": "while", "amongst": "among",
    "commonly": "often", "inform": "tell", "informed": "told", "acquire": "get", "acquired": "got",
    "accomplish": "do", "accomplished": "did", "adequate": "enough", "advise": "tell", "allocate": "give",
    "apparent": "clear", "appropriate": "right", "ascertain": "find out", "beverage": "drink", "consume": "eat",
    "consumed": "ate", "construct": "build", "constructed": "built", "contribute": "add", "deceased": "dead",
    "depart": "leave", "departed": "left", "designate": "name", "disclose": "tell", "discontinue": "stop",
    "dwelling": "home", "equivalent to": "equal to", "examine": "look at", "examined": "looked at",
    "exceed": "be more than", "exceeds": "is more than", "excessive": "too much", "expenditure": "spending",
    "finalise": "finish", "forward": "send", "illustrate": "show", "illustrates": "shows", "implement": "carry out",
    "inception": "start", "magnitude": "size", "maximum": "most", "minimum": "least", "necessitate": "need",
    "notify": "tell", "notwithstanding": "despite", "optimal": "best", "perceive": "see", "permit": "let",
    "permitted": "allowed", "principal": "main", "prioritise": "put first", "proficiency": "skill", "relocate": "move",
    "remunerate": "pay", "request": "ask for", "requested": "asked for", "residence": "home", "reveal": "show",
    "revealed": "showed", "significantly": "a lot", "similarly": "also", "solely": "only", "strategy": "plan",
    "terminated": "ended", "transpire": "happen", "vehicle": "car", "verify": "check", "whereas": "but",
    "with the exception of": "except", "in spite of": "despite", "in excess of": "more than", "a majority of": "most",
    "for example": "like", "obligated": "must", "is required to": "must", "are required to": "must"
  };
  var SIMPLE_RE = new RegExp("\\b(" + Object.keys(SIMPLE).sort(function (a, b) { return b.length - a.length; })
    .map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+"); }).join("|") + ")\\b", "gi");

  function matchCase(orig, rep) {
    if (orig.length > 1 && orig === orig.toUpperCase() && /[A-Z]/.test(orig)) return rep.toUpperCase();
    if (/^[A-Z]/.test(orig)) return cap(rep);
    return rep;
  }

  // Split sentences on semicolons and, for very long sentences, at ", but" / ", so" / ", and".
  function splitLongSentences(text, stats) {
    text = text.replace(/;\s+(?=[a-z])/g, function (m, off) {
      var left = text.slice(0, off), right = text.slice(off + m.length);
      if (wordCount(left.split(/[.!?]\s/).pop()) < 4 || wordCount(right.split(/[.!?]/)[0]) < 4) return m;
      stats.splits++;
      return ". ";
    }).replace(/\. ([a-z])/g, function (m, c) { return ". " + c.toUpperCase(); });
    var starts = [0].concat(sentenceStarts(text)), out = "";
    for (var i = 0; i < starts.length; i++) {
      var s = text.slice(starts[i], starts[i + 1] == null ? text.length : starts[i + 1]);
      if (wordCount(s) > 24) {
        s = s.replace(/,\s+(but|so|and|because|which means)\s+/, function (m, conj, off) {
          var left = s.slice(0, off), right = s.slice(off + m.length);
          if (wordCount(left) < 7 || wordCount(right) < 6) return m;
          stats.splits++;
          if (conj === "and") return ". ";
          return ". " + cap(conj) + " ";
        });
        s = s.replace(/\. ([a-z])/g, function (m, c) { return ". " + c.toUpperCase(); });
      }
      out += s;
    }
    return out;
  }

  function simplifyRuns(runs, stats) {
    var out = [];
    runs.forEach(function (r) {
      var text = splitLongSentences(r.text, stats), last = 0, m;
      SIMPLE_RE.lastIndex = 0;
      while ((m = SIMPLE_RE.exec(text))) {
        var key = m[0].toLowerCase().replace(/\s+/g, " ");
        var rep = SIMPLE[key];
        if (!rep) continue;
        if (m.index > last) out.push(Object.assign({}, r, { text: text.slice(last, m.index) }));
        out.push(Object.assign({}, r, { text: matchCase(m[0], rep), chg: true, was: m[0] }));
        stats.words++;
        last = m.index + m[0].length;
      }
      if (last < text.length) out.push(Object.assign({}, r, { text: text.slice(last) }));
    });
    // "a" before a vowel sound created by a swap ("an additional" -> "an extra" is fine, "a ... " checks)
    for (var i = 1; i < out.length; i++) {
      if (!out[i].chg) continue;
      var prev = out[i - 1];
      if (/\ban\s$/i.test(prev.text) && /^[^aeiou]/i.test(out[i].text)) prev.text = prev.text.replace(/\b(a)n(\s)$/i, "$1$2");
      else if (/\ba\s$/i.test(prev.text) && /^[aeiou]/i.test(out[i].text)) prev.text = prev.text.replace(/\b(a)(\s)$/i, "$1n$2");
    }
    return out;
  }

  var VERBS = ["explain", "describe", "list", "circle", "underline", "highlight", "calculate", "compare", "identify",
    "name", "write", "draw", "label", "read", "answer", "complete", "match", "choose", "show", "solve", "discuss",
    "define", "order", "sort", "tick", "colour", "color", "fill in", "find", "justify", "predict", "summarise",
    "summarize", "evaluate", "analyse", "analyze", "outline", "state", "give", "measure", "estimate", "plot",
    "construct", "sketch", "cross out", "use", "work out", "copy", "rewrite", "select", "not", "never", "all", "both", "each"];
  var VERB_RE = new RegExp("\\b(" + VERBS.map(function (v) { return v.replace(/ /g, "\\s+"); }).join("|") + ")\\b(?!\\s*:)", "gi");

  function boldWords(runs) {
    var out = [];
    runs.forEach(function (r) {
      if (r.b) { out.push(r); return; }
      var text = r.text, last = 0, m;
      VERB_RE.lastIndex = 0;
      while ((m = VERB_RE.exec(text))) {
        if (m.index > last) out.push(Object.assign({}, r, { text: text.slice(last, m.index) }));
        out.push(Object.assign({}, r, { text: m[0], b: true }));
        last = m.index + m[0].length;
      }
      if (last < text.length) out.push(Object.assign({}, r, { text: text.slice(last) }));
    });
    return out;
  }

  var ICONS = [
    [/^(re-?read|read)\b/i, "\uD83D\uDCD6"],
    [/^(draw|sketch|colou?r|design|label)\b/i, "\uD83D\uDD8D\uFE0F"],
    [/^(circle|underline|highlight|cross out)\b/i, "\uD83D\uDD8A\uFE0F"],
    [/^(tick|choose|select|match|sort|order|rank)\b/i, "\u2611\uFE0F"],
    [/^(calculate|solve|work out|measure|estimate|add|subtract|multiply|divide|count|round|plot|graph|convert|simplify)\b/i, "\uD83D\uDD22"],
    [/^(discuss|talk|share|tell|think|predict|compare|brainstorm)\b/i, "\uD83D\uDCAC"],
    [/^(look|observe|watch|find|identify|locate|search|investigate)\b/i, "\uD83D\uDD0D"],
    [/^(listen)\b/i, "\uD83D\uDC42"],
    [/^(cut|glue|stick|fold)\b/i, "\u2702\uFE0F"],
    [/^(write|answer|complete|fill|explain|describe|list|define|name|state|give|justify|summari[sz]e|outline|rewrite|copy|record|evaluate|analy[sz]e|use)\b/i, "\u270F\uFE0F"]
  ];
  function iconFor(text) {
    var t = text.replace(/^[\s"'“‘(]+/, "");
    if (/^[A-Za-z]+\s*:/.test(t)) return null; // a label such as "Name:" is not an instruction
    for (var i = 0; i < ICONS.length; i++) if (ICONS[i][0].test(t)) return ICONS[i][1];
    return null;
  }

  // ------------------------------------------------------------------ question detection

  var QNUM = /^\s*((?:Q(?:uestion)?\.?\s*)?\d{1,3}\s*[.):]|Q\d{1,3}|Question\s+\d{1,3})\s+/i;
  var BLANK_LINE = /^[\s_.…\-–—]*$/;
  function isAnswerLine(b) {
    if (b.t !== "p") return false;
    var t = runsText(b.runs);
    return BLANK_LINE.test(t) && /[_.…]{4,}/.test(t);
  }

  function detectQuestions(blocks) {
    var numbered = 0;
    blocks.forEach(function (b) {
      if (b.t !== "p") return;
      if (b.list && b.list.ordered && b.list.level === 0) { b.q = true; numbered++; return; }
      if (b.list) return;
      var m = QNUM.exec(runsText(b.runs));
      if (m && runsText(b.runs).length > m[0].length + 1) {
        stripPrefix(b.runs, m[0].length);
        b.num = m[1].trim();
        b.q = true;
        numbered++;
      }
    });
    if (!numbered) {
      blocks.forEach(function (b) {
        if (b.t === "p" && !b.list && /\?\s*["'”’)]?\s*$/.test(runsText(b.runs))) b.q = true;
      });
    }
    var questions = [], g = -1;
    blocks.forEach(function (b, i) {
      if (b.t === "h" || b.t === "pagebreak") g = -1;
      if (b.q) g = questions.push({ index: i, text: runsText(b.runs).replace(/\s+/g, " ").trim(), num: b.num || "" }) - 1;
      if (g >= 0 && b.t !== "h" && b.t !== "pagebreak") b.group = g;
    });
    return questions;
  }

  // ------------------------------------------------------------------ Word (.docx) reader

  function attr(e, name) {
    if (!e) return null;
    var v = e.getAttributeNS(W_NS, name);
    if (v == null || v === "") v = e.getAttribute("w:" + name);
    return v;
  }
  function kid(e, name) {
    if (!e) return null;
    for (var c = e.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) return c;
    return null;
  }
  function kids(e, name) {
    var out = [];
    for (var c = e.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) out.push(c);
    return out;
  }
  function descendants(e, name) {
    var out = [], all = e.getElementsByTagName("*");
    for (var i = 0; i < all.length; i++) if (all[i].localName === name) out.push(all[i]);
    return out;
  }
  function onOff(rPr, name) {
    var e = kid(rPr, name);
    if (!e) return false;
    var v = attr(e, "val");
    return !(v === "0" || v === "false" || v === "off");
  }

  function fmtNumber(n, fmt) {
    switch (fmt) {
      case "lowerLetter": return String.fromCharCode(96 + ((n - 1) % 26) + 1);
      case "upperLetter": return String.fromCharCode(64 + ((n - 1) % 26) + 1);
      case "lowerRoman": return roman(n).toLowerCase();
      case "upperRoman": return roman(n);
      default: return String(n);
    }
  }
  function roman(n) {
    var r = "", v = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    v.forEach(function (p) { while (n >= p[0]) { r += p[1]; n -= p[0]; } });
    return r;
  }

  function parseDocx(u8) {
    var files;
    try {
      files = fflate.unzipSync(u8, { filter: function (f) { return f.name.indexOf("word/") === 0; } });
    } catch (e) {
      throw new Error("This file couldn't be opened as a Word document. If it's an older .doc file, open it in Word and choose Save As \u2192 Word Document (.docx).");
    }
    var txt = function (n) { return files[n] ? fflate.strFromU8(files[n]) : null; };
    var parse = function (s) { return new DOMParser().parseFromString(s, "application/xml"); };
    var docXml = txt("word/document.xml");
    if (!docXml) throw new Error("This doesn't look like a Word document (no document text inside).");

    var rels = {};
    var relsXml = txt("word/_rels/document.xml.rels");
    if (relsXml) {
      var relEls = parse(relsXml).getElementsByTagName("Relationship");
      for (var i = 0; i < relEls.length; i++) rels[relEls[i].getAttribute("Id")] = relEls[i].getAttribute("Target");
    }

    var styles = {};
    var stylesXml = txt("word/styles.xml");
    if (stylesXml) {
      descendants(parse(stylesXml).documentElement, "style").forEach(function (st) {
        var id = attr(st, "styleId"), name = (attr(kid(st, "name"), "val") || "").toLowerCase();
        var info = { heading: 0, basedOn: attr(kid(st, "basedOn"), "val"), numId: null, ilvl: 0 };
        var hm = /^heading\s*(\d)/.exec(name);
        if (hm) info.heading = Math.min(3, +hm[1]);
        else if (name === "title") info.heading = 1;
        else if (name === "subtitle") info.heading = 2;
        var pPr = kid(st, "pPr");
        var ol = kid(pPr, "outlineLvl");
        if (!info.heading && ol && +attr(ol, "val") < 3) info.heading = +attr(ol, "val") + 1;
        var np = kid(pPr, "numPr");
        if (np) { info.numId = attr(kid(np, "numId"), "val"); info.ilvl = +(attr(kid(np, "ilvl"), "val") || 0); }
        styles[id] = info;
      });
    }
    function styleInfo(id) {
      var s = styles[id], depth = 0, out = { heading: 0, numId: null, ilvl: 0 };
      while (s && depth++ < 8) {
        if (!out.heading && s.heading) out.heading = s.heading;
        if (out.numId == null && s.numId) { out.numId = s.numId; out.ilvl = s.ilvl; }
        s = styles[s.basedOn];
      }
      return out;
    }

    var abstracts = {}, nums = {};
    var numXml = txt("word/numbering.xml");
    if (numXml) {
      var nroot = parse(numXml).documentElement;
      kids(nroot, "abstractNum").forEach(function (a) {
        var lv = {};
        kids(a, "lvl").forEach(function (l) {
          lv[+attr(l, "ilvl")] = { fmt: attr(kid(l, "numFmt"), "val") || "decimal", text: attr(kid(l, "lvlText"), "val") || "%1.", start: +(attr(kid(l, "start"), "val") || 1) };
        });
        abstracts[attr(a, "abstractNumId")] = lv;
      });
      kids(nroot, "num").forEach(function (n) { nums[attr(n, "numId")] = attr(kid(n, "abstractNumId"), "val"); });
    }
    var counters = {};
    function listInfo(numId, ilvl) {
      var lv = abstracts[nums[numId]] || {};
      var def = lv[ilvl] || { fmt: "bullet", text: "\u2022", start: 1 };
      if (def.fmt === "bullet" || def.fmt === "none") return { ordered: false, level: Math.min(ilvl, 2), num: def.fmt === "none" ? "" : "\u2022" };
      var c = counters[numId] || (counters[numId] = []);
      c[ilvl] = (c[ilvl] == null ? (def.start || 1) - 1 : c[ilvl]) + 1;
      for (var k = ilvl + 1; k < 9; k++) c[k] = null;
      var label = def.text.replace(/%(\d)/g, function (m, d) {
        var L = +d - 1, ld = lv[L] || def;
        return fmtNumber(c[L] == null ? (ld.start || 1) : c[L], ld.fmt);
      });
      return { ordered: true, level: Math.min(ilvl, 2), num: label };
    }

    var images = {}, imgCount = 0, warnings = [];
    function addImage(rid, cx, cy) {
      var target = rels[rid];
      if (!target) return null;
      var path = target.charAt(0) === "/" ? target.slice(1) : "word/" + target.replace(/^\.\//, "");
      path = path.replace(/[^/]+\/\.\.\//g, "");
      var data = files[path];
      if (!data) return null;
      var ext = (path.split(".").pop() || "png").toLowerCase();
      if (ext === "jpg") ext = "jpeg";
      var id = "img" + (++imgCount);
      var mime = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp" }[ext];
      images[id] = { ext: ext, b64: bytesToBase64(data), mime: mime || null };
      return { t: "img", img: id, cx: cx || 0, cy: cy || 0 };
    }

    function parseDrawing(d, items) {
      descendants(d, "txbxContent").forEach(function (tb) {
        var sub = [];
        walkBlocks(tb, sub);
        if (sub.length) items.push({ blocks: sub });
      });
      var pics = descendants(d, "pic");
      var ext = descendants(d, "extent")[0];
      var cx = ext ? +ext.getAttribute("cx") : 0, cy = ext ? +ext.getAttribute("cy") : 0;
      if (!pics.length) {
        descendants(d, "blip").slice(0, 1).forEach(function (b) {
          var im = addImage(b.getAttributeNS(R_NS, "embed") || b.getAttribute("r:embed"), cx, cy);
          if (im) items.push({ block: im });
        });
        return;
      }
      pics.forEach(function (p) {
        var b = descendants(p, "blip")[0];
        if (!b) return;
        var pe = descendants(p, "ext").filter(function (e) { return e.getAttribute("cx"); })[0];
        var w = pics.length > 1 && pe ? +pe.getAttribute("cx") : cx, h = pics.length > 1 && pe ? +pe.getAttribute("cy") : cy;
        var im = addImage(b.getAttributeNS(R_NS, "embed") || b.getAttribute("r:embed"), w, h);
        if (im) items.push({ block: im });
      });
    }
    function parsePict(p, items) {
      descendants(p, "txbxContent").forEach(function (tb) {
        var sub = [];
        walkBlocks(tb, sub);
        if (sub.length) items.push({ blocks: sub });
      });
      descendants(p, "imagedata").forEach(function (im) {
        var rid = im.getAttributeNS(R_NS, "id") || im.getAttribute("r:id");
        var shape = im.parentNode, style = (shape && shape.getAttribute && shape.getAttribute("style")) || "";
        var wm = /width:\s*([\d.]+)pt/.exec(style), hm = /height:\s*([\d.]+)pt/.exec(style);
        var b = addImage(rid, wm ? +wm[1] * 12700 : 0, hm ? +hm[1] * 12700 : 0);
        if (b) items.push({ block: b });
      });
    }

    function pushText(items, text, f) {
      var last = items[items.length - 1];
      if (last && last.run && last.run.b === f.b && last.run.i === f.i && last.run.u === f.u) last.run.text += text;
      else items.push({ run: { text: text, b: f.b, i: f.i, u: f.u } });
    }
    function parseRun(r, items) {
      var rPr = kid(r, "rPr"), u = kid(rPr, "u");
      var f = { b: onOff(rPr, "b"), i: onOff(rPr, "i"), u: !!(u && attr(u, "val") !== "none") };
      if (onOff(rPr, "vanish")) return;
      for (var c = r.firstElementChild; c; c = c.nextElementSibling) {
        switch (c.localName) {
          case "t": pushText(items, c.textContent, f); break;
          case "tab": case "ptab": pushText(items, "\t", f); break;
          case "br":
            if (attr(c, "type") === "page") items.push({ pb: true });
            else pushText(items, "\n", f);
            break;
          case "cr": pushText(items, "\n", f); break;
          case "noBreakHyphen": pushText(items, "-", f); break;
          case "softHyphen": break;
          case "sym": pushText(items, "\u2022", f); break;
          case "drawing": parseDrawing(c, items); break;
          case "pict": case "object": parsePict(c, items); break;
          case "AlternateContent": {
            var ch = c.firstElementChild;
            if (ch) for (var d = ch.firstElementChild; d; d = d.nextElementSibling) {
              if (d.localName === "drawing") parseDrawing(d, items);
              else if (d.localName === "pict") parsePict(d, items);
            }
            break;
          }
        }
      }
    }
    function walkRuns(node, items) {
      for (var c = node.firstElementChild; c; c = c.nextElementSibling) {
        switch (c.localName) {
          case "r": parseRun(c, items); break;
          case "hyperlink": case "ins": case "smartTag": case "fldSimple": case "customXml": case "sdtContent": case "moveTo": case "dir": case "bdo":
            walkRuns(c, items); break;
          case "sdt": { var sc = kid(c, "sdtContent"); if (sc) walkRuns(sc, items); break; }
          case "AlternateContent": { var ch = c.firstElementChild; if (ch) walkRuns(ch, items); break; }
        }
      }
    }
    function parsePara(p, out) {
      var pPr = kid(p, "pPr"), heading = 0, list = null, numId = null, ilvl = 0;
      var ps = kid(pPr, "pStyle");
      if (ps) {
        var si = styleInfo(attr(ps, "val"));
        heading = si.heading;
        if (si.numId) { numId = si.numId; ilvl = si.ilvl; }
      }
      var ol = kid(pPr, "outlineLvl");
      if (!heading && ol && +attr(ol, "val") < 3) heading = +attr(ol, "val") + 1;
      var np = kid(pPr, "numPr");
      if (np) {
        if (kid(np, "numId")) numId = attr(kid(np, "numId"), "val");
        if (kid(np, "ilvl")) ilvl = +(attr(kid(np, "ilvl"), "val") || 0);
      }
      if (numId && numId !== "0" && !heading) list = listInfo(numId, ilvl);
      if (pPr && kid(pPr, "pageBreakBefore") && onOff(pPr, "pageBreakBefore")) out.push({ t: "pagebreak" });

      var items = [];
      walkRuns(p, items);
      var runs = [], first = true;
      var flush = function () {
        trimRuns(runs);
        if (runs.length && runsText(runs).trim()) {
          var b = heading ? { t: "h", level: heading, runs: runs } : { t: "p", runs: runs };
          if (list && !heading && first) { b.list = { ordered: list.ordered, level: list.level }; b.num = list.num; }
          else if (list && !heading) b.cont = true;
          out.push(b);
          first = false;
        } else if (!runs.length && !first) { /* nothing */ }
        runs = [];
      };
      items.forEach(function (it) {
        if (it.run) runs.push(it.run);
        else if (it.pb) { flush(); out.push({ t: "pagebreak" }); }
        else if (it.block) { flush(); out.push(it.block); }
        else if (it.blocks) { flush(); it.blocks.forEach(function (b) { out.push(b); }); }
      });
      flush();
    }
    function parseTable(tbl) {
      var rows = [];
      kids(tbl, "tr").forEach(function (tr) {
        var row = [];
        var cells = kids(tr, "tc");
        kids(tr, "sdt").forEach(function (s) { var sc = kid(s, "sdtContent"); if (sc) cells = cells.concat(kids(sc, "tc")); });
        cells.forEach(function (tc) {
          var blocks = [];
          walkBlocks(tc, blocks);
          var cell = [];
          blocks.forEach(function (b) {
            if (b.t === "p" || b.t === "img") cell.push(b);
            else if (b.t === "h") cell.push({ t: "p", runs: b.runs.map(function (r) { return Object.assign({}, r, { b: true }); }) });
            else if (b.t === "table") b.rows.forEach(function (rr) {
              cell.push({ t: "p", runs: [{ text: rr.map(function (c) { return c.map(function (x) { return x.runs ? runsText(x.runs) : ""; }).join(" "); }).join(" | ") }] });
            });
          });
          row.push(cell);
        });
        if (row.length) rows.push(row);
      });
      return rows.length ? { t: "table", rows: rows } : null;
    }
    function walkBlocks(container, out) {
      for (var c = container.firstElementChild; c; c = c.nextElementSibling) {
        switch (c.localName) {
          case "p": parsePara(c, out); break;
          case "tbl": { var t = parseTable(c); if (t) out.push(t); break; }
          case "sdt": { var sc = kid(c, "sdtContent"); if (sc) walkBlocks(sc, out); break; }
          case "customXml": case "ins": walkBlocks(c, out); break;
          case "AlternateContent": { var ch = c.firstElementChild; if (ch) walkBlocks(ch, out); break; }
        }
      }
    }

    var doc = parse(docXml);
    if (doc.getElementsByTagName("parsererror").length) throw new Error("The Word document looks damaged and couldn't be read.");
    var body = descendants(doc.documentElement, "body")[0];
    var blocks = [];
    walkBlocks(body, blocks);
    // Tidy: drop leading/trailing/double page breaks.
    blocks = blocks.filter(function (b, i, arr) { return !(b.t === "pagebreak" && (i === 0 || i === arr.length - 1 || arr[i - 1].t === "pagebreak")); });
    var unshown = Object.keys(images).filter(function (k) { return !images[k].mime; }).length;
    if (unshown) warnings.push(unshown + " picture(s) are in a format the preview can't show (such as a Word drawing). They are still kept in the Word download.");
    return { blocks: blocks, images: images, warnings: warnings };
  }

  // ------------------------------------------------------------------ PDF reader

  var BULLET = /^[\u2022\u25CF\u25AA\u25A0\u25E6\u25CB\u2023\u2043\u2219\uF0B7\uF0A7\uF076\uF0D8\uF0FC\u27A2\u25BA\u2013\u2014*-]\s*/;
  async function parsePdf(u8) {
    if (typeof pdfjsLib === "undefined") throw new Error("The PDF reader didn't load.");
    var task = pdfjsLib.getDocument({
      data: u8, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, disableAutoFetch: true,
      disableStream: true, disableRange: true, stopAtErrors: false, enableXfa: false, verbosity: 0
    });
    var pdf;
    try { pdf = await task.promise; }
    catch (e) {
      if (e && e.name === "PasswordException") throw new Error("This PDF is password protected. Open it, save a copy without a password, then try again.");
      throw new Error("This file couldn't be opened as a PDF.");
    }
    var lines = [], chars = 0;
    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p);
      var vp = page.getViewport({ scale: 1 });
      var tc = await page.getTextContent();
      var cur = null, pageLines = [];
      tc.items.forEach(function (it) {
        if (typeof it.str !== "string") return;
        var tr = it.transform, size = Math.round(Math.hypot(tr[2], tr[3]) * 2) / 2 || it.height || 10;
        var x = tr[4], y = vp.height - tr[5];
        if (!it.str.length) { if (it.hasEOL && cur) cur.eol = true; return; }
        if (cur && Math.abs(y - cur.y) < Math.max(cur.size, size) * 0.5 && x >= cur.xEnd - size * 2) {
          var gap = x - cur.xEnd;
          if (gap > size * 0.18 && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) cur.text += " ";
          cur.text += it.str;
          cur.xEnd = x + (it.width || 0);
          cur.size = Math.max(cur.size, size);
        } else {
          cur = { text: it.str, x: x, xEnd: x + (it.width || 0), y: y, size: size, page: p, ph: vp.height };
          pageLines.push(cur);
        }
        chars += it.str.trim().length;
      });
      // Drop page numbers and repeated running headers/footers.
      pageLines = pageLines.filter(function (l) {
        var t = l.text.trim();
        var edge = l.y < l.ph * 0.08 || l.y > l.ph * 0.92;
        return t && !(edge && /^(page\s*)?\d{1,3}(\s*(of|\/)\s*\d{1,3})?$/i.test(t));
      });
      lines = lines.concat(pageLines);
      page.cleanup();
    }
    var warnings = [];
    if (chars < 40 * pdf.numPages) {
      warnings.push("Very little text was found in this PDF. If it is a scan (a photo of pages), Adjust Me can't read it offline. Use the Word version, or retype the text.");
    }
    warnings.push("From a PDF only the text comes across: pictures and table layouts don't. Check the preview, and use the Word version of the worksheet if you have it.");
    pdf.destroy();

    // Remove lines that repeat on most pages (headers/footers).
    if (pdf.numPages > 2) {
      var seen = {};
      lines.forEach(function (l) { var k = l.text.trim(); if (l.y < l.ph * 0.1 || l.y > l.ph * 0.9) seen[k] = (seen[k] || 0) + 1; });
      lines = lines.filter(function (l) { var k = l.text.trim(); return !(seen[k] >= Math.ceil(pdf.numPages * 0.6) && (l.y < l.ph * 0.1 || l.y > l.ph * 0.9)); });
    }

    // Body text size = the size used by most characters.
    var bySize = {};
    lines.forEach(function (l) { bySize[l.size] = (bySize[l.size] || 0) + l.text.length; });
    var body = +Object.keys(bySize).sort(function (a, b) { return bySize[b] - bySize[a]; })[0] || 11;
    var headSizes = Object.keys(bySize).map(Number).filter(function (s) { return s >= body * 1.15; }).sort(function (a, b) { return b - a; });
    var levelOf = function (size) { var i = headSizes.indexOf(size); return i < 0 ? 0 : Math.min(3, i + 1); };

    var blocks = [], para = null, prev = null;
    lines.forEach(function (l) {
      var t = l.text.replace(/\s+/g, " ").trim();
      var lvl = t.length < 140 ? levelOf(l.size) : 0;
      var bullet = BULLET.test(t) && !/^-\d/.test(t);
      var numbered = QNUM.test(t) || /^\(?[a-hA-H][.)]\s/.test(t);
      var gap = prev && prev.page === l.page ? l.y - prev.y : null;
      var lineH = prev ? prev.size * 1.25 : 0;
      var answer = /^[_.…\s]{6,}$/.test(t);
      var startNew = !para || bullet || numbered || answer || isAnswerLine(para) || (para.t === "h") !== (lvl > 0) ||
        (para.t === "h" && para.level !== lvl) || (gap != null && (gap > lineH * 1.5 || gap < -2)) ||
        (gap == null && !/^[a-z]/.test(t)) || Math.abs(l.size - prev.size) > 1.5;
      if (startNew) {
        if (bullet) t = t.replace(BULLET, "");
        para = lvl ? { t: "h", level: lvl, runs: [{ text: t }] } : { t: "p", runs: [{ text: t }] };
        if (bullet) { para.list = { ordered: false, level: l.x - (prev ? prev.x : l.x) > 15 ? 1 : 0 }; para.num = "\u2022"; }
        blocks.push(para);
      } else {
        var r = para.runs[0];
        if (/[A-Za-z]-$/.test(r.text) && /^[a-z]/.test(t)) r.text = r.text.slice(0, -1) + t;
        else r.text += " " + t;
      }
      prev = l;
    });
    return { blocks: blocks, images: {}, warnings: warnings };
  }

  // ------------------------------------------------------------------ the made-up sample worksheet

  function sampleDoc() {
    var P = function (t, extra) { return Object.assign({ t: "p", runs: [{ text: t }] }, extra || {}); };
    return {
      blocks: [
        { t: "h", level: 1, runs: [{ text: "The Water Cycle" }] },
        P("Water is constantly moving around our planet in a process known as the water cycle; it has no beginning and no end. Approximately 97 percent of the water on Earth is located in the oceans, and the remainder is found in rivers, lakes, ice and the air."),
        { t: "p", runs: [{ text: "When the sun heats the ocean, water evaporates and rises into the air as water vapour. " }, { text: "This process is called evaporation.", i: true }, { text: " As the vapour rises, it cools and condenses into tiny droplets, which subsequently form clouds." }] },
        { t: "h", level: 2, runs: [{ text: "Questions" }] },
        P("1. Explain what happens to water when the sun heats the ocean."),
        P("_______________________________________________"),
        P("2. Approximately how much of Earth's water is located in the oceans?"),
        P("3. Draw and label a diagram of the water cycle. Use arrows to show the direction the water moves."),
        P("4. Describe two places where water is stored, other than the ocean."),
        P("5. Predict what would occur if the sun did not heat the water. Give a reason for your answer."),
        P("6. Circle the words that describe a change of state: evaporation, river, condensation, cloud, freezing."),
        { t: "h", level: 2, runs: [{ text: "Extension" }] },
        P("Read the passage again and underline every word that is related to temperature. Do not use a highlighter.")
      ],
      images: {}, warnings: ["This is a made-up sample. Load your own .docx or .pdf to adjust a real worksheet."]
    };
  }

  // ------------------------------------------------------------------ the adjustments

  function forEachPara(blocks, fn) {
    blocks.forEach(function (b) {
      if (b.t === "p" || b.t === "h") fn(b);
      else if (b.t === "table") b.rows.forEach(function (r) { r.forEach(function (c) { c.forEach(function (x) { if (x.t === "p") fn(x); }); }); });
      else if (b.t === "box") forEachPara(b.blocks, fn);
    });
  }

  function adjust(doc, s) {
    var stats = { words: 0, splits: 0, removed: 0 };
    var blocks = clone(doc.blocks);

    // Questions and workload
    if (s.reduce && doc.questions.length) {
      blocks = blocks.filter(function (b) { return b.group == null || doc.keep[b.group] !== false; });
      stats.removed = doc.keep.filter(function (k) { return k === false; }).length;
      if (s.renumber) {
        var k = 0;
        blocks.forEach(function (b) {
          if (!b.q) return;
          k++;
          if (b.num && /\d/.test(b.num)) b.num = b.num.replace(/\d+/, String(k));
        });
      }
    }

    // Language
    forEachPara(blocks, function (b) {
      if (s.simplify) b.runs = simplifyRuns(b.runs, stats);
      if (s.noItalic) b.runs.forEach(function (r) { if (r.i || r.u) { r.b = true; r.i = false; r.u = false; } });
      if (s.boldVerbs && b.t === "p") b.runs = boldWords(b.runs);
    });

    // Working space: take out the old short answer lines inside questions; we add our own.
    if (s.space) blocks = blocks.filter(function (b) { return !(b.group != null && isAnswerLine(b)); });

    // Chunking
    if (s.chunk !== "off") {
      var per = s.chunk === "sentence" ? 1 : 2, out = [];
      blocks.forEach(function (b) {
        if (b.t !== "p" || isAnswerLine(b)) { out.push(b); return; }
        var text = runsText(b.runs), starts = sentenceStarts(text);
        if (starts.length < per) { out.push(b); return; }
        var cuts = starts.filter(function (_, i) { return (i + 1) % per === 0; });
        var parts = splitRuns(b.runs, cuts);
        parts.forEach(function (rs, i) {
          var nb = Object.assign({}, b, { runs: rs });
          if (i > 0) { delete nb.num; delete nb.q; nb.cont = !!(b.num || b.list || b.cont || b.q); nb.chunk = true; delete nb.list; if (b.list) nb.lvl = b.list.level; }
          out.push(nb);
        });
      });
      blocks = out;
    }

    // Visual cues and tick boxes
    blocks.forEach(function (b) {
      if (b.t !== "p") return;
      if (s.icons && !b.cont) {
        var ic = iconFor(runsText(b.runs));
        if (ic) b.icon = ic;
      }
      if (s.checklist && b.q) b.check = true;
    });

    // Pictures
    if (s.imgSize === "hide") blocks = blocks.filter(function (b) { return b.t !== "img"; });

    // Group questions: add space after, box them, one per page.
    var grouped = [], i = 0, firstGroup = true;
    while (i < blocks.length) {
      var b = blocks[i];
      if (b.group == null) { grouped.push(b); i++; continue; }
      var g = b.group, members = [];
      while (i < blocks.length && blocks[i].group === g) members.push(blocks[i++]);
      if (s.space) {
        var n = +s.spaceLines;
        members.push(s.spaceStyle === "box" ? { t: "abox", n: n } : { t: "lines", n: n });
      }
      if (s.onePerPage && !firstGroup && grouped.length && grouped[grouped.length - 1].t !== "pagebreak") grouped.push({ t: "pagebreak" });
      firstGroup = false;
      if (s.boxes) grouped.push({ t: "box", blocks: members });
      else grouped = grouped.concat(members);
    }
    blocks = grouped;

    // Top of the page
    var top = [];
    var hasName = blocks.slice(0, 8).some(function (b) { return b.t === "p" && NAME_LINE.test(runsText(b.runs)); });
    if (s.nameLine && !hasName) top.push({ t: "nameline" });
    if (s.keywords) {
      var items = parseKeywords(s.keywordText);
      if (items.length) top.push({ t: "kw", items: items });
    }
    // Keep the title above the name line and key words.
    if (top.length) {
      var at = blocks.length && blocks[0].t === "h" ? 1 : 0;
      blocks = blocks.slice(0, at).concat(top, blocks.slice(at));
    }
    return { blocks: blocks, stats: stats };
  }

  var NAME_LINE = /^\s*(student('s)?\s*)?name\s*[:_.]/i;

  function parseKeywords(text) {
    return String(text || "").split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean).slice(0, 30).map(function (l) {
      var m = /^(.+?)\s*(?:\s[-–—:=]\s*|\t)\s*(.+)$/.exec(l);
      return m ? [m[1], m[2]] : [l, ""];
    });
  }

  var COMMON_LONG = ("because between different important something together following question questions answer answers another " +
    "without through should would could before example examples around people picture pictures diagram describe explain underline " +
    "direction highlighter percent everything worksheet difference calculate information sentence sentences paragraph passage " +
    "yourself remember complete including including include includes something someone sometimes probably actually " +
    "beginning continue different usually themselves interesting important understand understanding labelled reason " +
    "reasons describe describes explain explains extension activity activities students student teacher teachers").split(" ");
  function suggestKeywords(doc) {
    var counts = {}, skip = {};
    COMMON_LONG.forEach(function (w) { skip[w] = true; });
    VERBS.forEach(function (w) { skip[w] = true; });
    doc.blocks.forEach(function (b) {
      if (b.t === "h") (runsText(b.runs).match(/[A-Za-z]+/g) || []).forEach(function (w) { skip[w.toLowerCase()] = true; });
    });
    forEachPara(doc.blocks, function (b) {
      if (b.t !== "p") return;
      (runsText(b.runs).match(/\b[a-z][a-z]{6,}\b/g) || []).forEach(function (w) {
        var k = w.toLowerCase();
        if (skip[k] || skip[k.replace(/e?s$/, "")] || SIMPLE[k] || /ly$|ing$|ed$/.test(k)) return;
        var score = k.length >= 9 || /(tion|sion|ology|ism|sis|ity|ment|ance|ence|ure|ate)$/.test(k) ? 2 : 1;
        counts[k] = (counts[k] || 0) + score;
      });
    });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || b.length - a.length; }).slice(0, 6);
  }

  // ------------------------------------------------------------------ preview (HTML)

  function imgSizePx(b, s) {
    var w = b.cx ? b.cx / EMU_PER_PX : 0, h = b.cy ? b.cy / EMU_PER_PX : 0;
    var maxW = CONTENT_W_EMU / EMU_PER_PX;
    if (!w || !h) return null;
    var scale = s.imgSize === "bigger" ? 1.5 : 1;
    if (s.imgSize === "full") scale = maxW / w;
    w *= scale; h *= scale;
    if (w > maxW) { h *= maxW / w; w = maxW; }
    return { w: w, h: h };
  }

  function runsHtml(runs, s) {
    return runs.map(function (r) {
      var t = escHtml(r.text);
      if (r.b) t = "<b>" + t + "</b>";
      if (r.i) t = "<i>" + t + "</i>";
      if (r.u) t = "<u>" + t + "</u>";
      if (r.chg && s.showChanges) t = '<mark class="chg" title="Was: ' + escHtml(r.was || "") + '">' + t + "</mark>";
      return t;
    }).join("");
  }
  function prefixText(b) {
    var parts = [];
    if (b.check) parts.push("\u2610");
    if (b.icon) parts.push('<span class="icon">' + b.icon + "</span>");
    if (b.num) parts.push(escHtml(b.num));
    return parts.join(" ");
  }
  function paraHtml(b, s) {
    if (b.t === "h") {
      var L = Math.min(3, b.level || 1);
      return "<h" + L + ">" + runsHtml(b.runs, s) + "</h" + L + ">";
    }
    var lvl = b.list ? b.list.level : (b.lvl || 0);
    var cls = (lvl ? " lvl" + lvl : "") + (b.cont ? " cont" : "") + (b.q ? " q" : "");
    var pre = prefixText(b);
    if (pre) return '<p class="pf' + cls + '"><span class="pre">' + pre + '</span><span class="bd">' + runsHtml(b.runs, s) + "</span></p>";
    return '<p class="' + cls.trim() + '">' + runsHtml(b.runs, s) + "</p>";
  }
  function blockHtml(b, s, images) {
    switch (b.t) {
      case "h": case "p": return paraHtml(b, s);
      case "img": {
        var im = images[b.img];
        if (!im) return "";
        if (!im.mime) return '<div class="img"><span class="noimg">Picture (kept in the Word download)</span></div>';
        var sz = imgSizePx(b, s);
        var st = sz ? ' style="width:' + sz.w.toFixed(0) + 'px"' : "";
        return '<div class="img"><img alt="" src="data:' + im.mime + ";base64," + im.b64 + '"' + st + "></div>";
      }
      case "table":
        return '<table class="tbl">' + b.rows.map(function (r) {
          return "<tr>" + r.map(function (c) { return "<td>" + c.map(function (x) { return blockHtml(x, s, images); }).join("") + "</td>"; }).join("") + "</tr>";
        }).join("") + "</table>";
      case "pagebreak": return '<div class="pb" role="separator"></div>';
      case "lines": {
        var h = LINE_GAP_MM[s.lineGap] || 10, out = '<div class="lines">';
        for (var i = 0; i < b.n; i++) out += '<div style="height:' + h + 'mm"></div>';
        return out + "</div>";
      }
      case "abox": return '<div class="abox" style="height:' + (b.n * (LINE_GAP_MM[s.lineGap] || 10)) + 'mm"></div>';
      case "box": return '<div class="qbox">' + b.blocks.map(function (x) { return blockHtml(x, s, images); }).join("") + "</div>";
      case "nameline": return '<p class="nameline">Name: ________________________ &nbsp; Date: ____________</p>';
      case "kw":
        return '<div class="kw"><div class="kw-title">Key words</div>' + b.items.map(function (it) {
          return "<p><b>" + escHtml(it[0]) + "</b>" + (it[1] ? " \u2013 " + escHtml(it[1]) : "") + "</p>";
        }).join("") + "</div>";
    }
    return "";
  }

  function fontStack(f) {
    var fallback = { "Century Gothic": "'Century Gothic', 'Avenir Next', Futura, 'Trebuchet MS', sans-serif", "Comic Sans MS": "'Comic Sans MS', 'Comic Neue', 'Chalkboard SE', sans-serif" };
    return fallback[f] || ("'" + f + "', Arial, Helvetica, sans-serif");
  }

  // ------------------------------------------------------------------ Word (.docx) writer

  var TWIP_CONTENT = 11906 - 2 * 1134;
  function hex(c) { return c.replace("#", "").toUpperCase(); }

  function buildDocx(blocks, s, images, title) {
    var media = [], relId = 100, drawId = 1, imgRel = {};
    var fs = +s.size, halfPts = Math.round(fs * 2);
    var charSpace = Math.round(s.letterSpacing * fs * 20);
    var lineVal = Math.round(240 * s.lineSpacing);
    var after = Math.round(Math.max(6, fs * 0.7) * 20);
    var gapTw = Math.round((LINE_GAP_MM[s.lineGap] || 10) * 56.7);

    function rXml(r) {
      var pr = (r.b ? "<w:b/><w:bCs/>" : "") + (r.i ? "<w:i/><w:iCs/>" : "") + (r.u ? '<w:u w:val="single"/>' : "");
      return textRuns(r.text, pr);
    }
    function textRuns(text, pr) {
      var rpr = pr ? "<w:rPr>" + pr + "</w:rPr>" : "";
      var bits = String(text).split(/(\t|\n)/), xml = "";
      bits.forEach(function (bit) {
        if (bit === "\t") xml += "<w:tab/>";
        else if (bit === "\n") xml += "<w:br/>";
        else if (bit) xml += '<w:t xml:space="preserve">' + escXml(bit) + "</w:t>";
      });
      return xml ? "<w:r>" + rpr + xml + "</w:r>" : "";
    }
    function pXml(b) {
      if (b.t === "h") {
        var L = Math.min(3, b.level || 1);
        return '<w:p><w:pPr><w:pStyle w:val="Heading' + L + '"/></w:pPr>' + b.runs.map(rXml).join("") + "</w:p>";
      }
      var lvl = b.list ? b.list.level : (b.lvl || 0);
      var pre = [];
      if (b.check) pre.push("\u2610");
      if (b.icon) pre.push(null);
      if (b.num) pre.push(b.num);
      var hang = 0, prefix = "";
      if (pre.length || b.cont) {
        hang = Math.round(fs * 20 * (s.checklist || s.icons ? 4.2 : 2));
        if (b.check) prefix += textRuns("\u2610 ", "");
        if (b.icon) prefix += textRuns(b.icon + " ", '<w:rFonts w:ascii="Segoe UI Emoji" w:hAnsi="Segoe UI Emoji" w:cs="Segoe UI Emoji"/>');
        if (b.num) prefix += textRuns(b.num, "");
        if (pre.length) prefix += "<w:r><w:tab/></w:r>";
      }
      var left = lvl * 567 + hang;
      var ind = left ? '<w:ind w:left="' + left + '"' + (pre.length ? ' w:hanging="' + hang + '"' : "") + "/>" : "";
      var tabs = pre.length ? '<w:tabs><w:tab w:val="left" w:pos="' + left + '"/></w:tabs>' : "";
      var keep = b.q ? "<w:keepNext/>" : "";
      return "<w:p><w:pPr>" + keep + tabs + ind + "</w:pPr>" + prefix + b.runs.map(rXml).join("") + "</w:p>";
    }
    function imgXml(b) {
      var im = images[b.img];
      if (!im) return "";
      var rid = imgRel[b.img];
      if (!rid) {
        rid = imgRel[b.img] = "rId" + (relId++);
        media.push({ rid: rid, name: "image" + media.length + "." + im.ext, data: base64ToBytes(im.b64) });
      }
      var cx = b.cx || 2000000, cy = b.cy || 1500000;
      var sz = imgSizePx(b, s);
      if (sz) { cx = Math.round(sz.w * EMU_PER_PX); cy = Math.round(sz.h * EMU_PER_PX); }
      var id = drawId++;
      return '<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
        '<wp:docPr id="' + id + '" name="Picture ' + id + '"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' + id + '" name="Picture ' + id + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
        '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    }
    function linesXml(n) {
      var bdr = '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="8A8A8A"/><w:between w:val="single" w:sz="6" w:space="1" w:color="8A8A8A"/></w:pBdr>';
      var one = '<w:p><w:pPr>' + bdr + '<w:spacing w:before="0" w:after="0" w:line="' + gapTw + '" w:lineRule="exact"/></w:pPr></w:p>';
      var out = "";
      for (var i = 0; i < n; i++) out += one;
      return out + spacer();
    }
    function aboxXml(n) {
      var side = function (sd) { return "<w:" + sd + ' w:val="single" w:sz="6" w:space="4" w:color="8A8A8A"/>'; };
      return '<w:p><w:pPr><w:pBdr>' + side("top") + side("left") + side("bottom") + side("right") + '</w:pBdr><w:spacing w:before="60" w:after="0" w:line="' + (gapTw * n) + '" w:lineRule="exact"/></w:pPr></w:p>' + spacer();
    }
    function spacer() { return '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="120" w:lineRule="exact"/></w:pPr></w:p>'; }
    function cellBorders(sz, color) {
      return ["top", "left", "bottom", "right", "insideH", "insideV"].map(function (sd) { return "<w:" + sd + ' w:val="single" w:sz="' + sz + '" w:space="0" w:color="' + color + '"/>'; }).join("");
    }
    function tableXml(b) {
      var cols = 0;
      b.rows.forEach(function (r) { cols = Math.max(cols, r.length); });
      var w = Math.floor(TWIP_CONTENT / cols), grid = "";
      for (var i = 0; i < cols; i++) grid += '<w:gridCol w:w="' + w + '"/>';
      var rows = b.rows.map(function (r) {
        var cells = r.map(function (c) {
          var inner = c.map(function (x) { return x.t === "img" ? imgXml(x) : pXml(x); }).join("");
          return '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/></w:tcPr>' + (inner || "<w:p/>") + "</w:tc>";
        });
        while (cells.length < cols) cells.push('<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/></w:tcPr><w:p/></w:tc>');
        return "<w:tr>" + cells.join("") + "</w:tr>";
      }).join("");
      return '<w:tbl><w:tblPr><w:tblW w:w="' + TWIP_CONTENT + '" w:type="dxa"/><w:tblBorders>' + cellBorders(4, "666666") + '</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' + grid + "</w:tblGrid>" + rows + "</w:tbl>" + spacer();
    }
    function boxXml(b, inner) {
      return '<w:tbl><w:tblPr><w:tblW w:w="' + TWIP_CONTENT + '" w:type="dxa"/><w:tblBorders>' + cellBorders(12, "555555") + '</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="140" w:type="dxa"/><w:left w:w="180" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="180" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
        '<w:tblGrid><w:gridCol w:w="' + TWIP_CONTENT + '"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="' + TWIP_CONTENT + '" w:type="dxa"/></w:tcPr>' + inner + "</w:tc></w:tr></w:tbl>" + spacer();
    }
    function blockXml(b) {
      switch (b.t) {
        case "h": case "p": return pXml(b);
        case "img": return imgXml(b);
        case "table": return tableXml(b);
        case "pagebreak": return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
        case "lines": return linesXml(b.n);
        case "abox": return aboxXml(b.n);
        case "box": {
          var inner = b.blocks.map(blockXml).join("");
          if (!/<\/w:p>$/.test(inner) && !/<w:p\/>$/.test(inner)) inner += "<w:p/>";
          return boxXml(b, inner);
        }
        case "nameline": return '<w:p><w:pPr><w:spacing w:after="' + (after * 2) + '"/></w:pPr>' + textRuns("Name: ________________________   Date: ____________", "") + "</w:p>";
        case "kw": {
          var ps = '<w:p><w:pPr><w:spacing w:after="60"/></w:pPr>' + textRuns("Key words", "<w:b/>") + "</w:p>";
          b.items.forEach(function (it) { ps += '<w:p><w:pPr><w:spacing w:after="40"/></w:pPr>' + textRuns(it[0], "<w:b/>") + (it[1] ? textRuns(" \u2013 " + it[1], "") : "") + "</w:p>"; });
          return boxXml(b, ps);
        }
      }
      return "";
    }

    var bodyXml = blocks.map(blockXml).join("");
    var tint = TINTS[s.tint] || "#ffffff";
    var ns = 'xmlns:w="' + W_NS + '" xmlns:r="' + R_NS + '" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
    var sect = '<w:sectPr>' + (s.pageNumbers ? '<w:footerReference w:type="default" r:id="rIdFooter1"/>' : "") +
      '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>';
    var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ' + ns + ">" +
      (s.tint !== "none" ? '<w:background w:color="' + hex(tint) + '"/>' : "") + "<w:body>" + bodyXml + sect + "</w:body></w:document>";

    var font = escXml(s.font);
    var rFonts = '<w:rFonts w:ascii="' + font + '" w:hAnsi="' + font + '" w:cs="' + font + '" w:eastAsia="' + font + '"/>';
    var heading = function (L, mult) {
      var sz = Math.round(fs * mult * 2);
      return '<w:style w:type="paragraph" w:styleId="Heading' + L + '"><w:name w:val="heading ' + L + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>' +
        '<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="' + Math.round(fs * 20 * 0.9) + '" w:after="' + Math.round(fs * 20 * 0.45) + '" w:line="' + Math.round(240 * Math.min(1.2, s.lineSpacing)) + '" w:lineRule="auto"/><w:outlineLvl w:val="' + (L - 1) + '"/></w:pPr>' +
        '<w:rPr><w:b/><w:bCs/><w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr></w:style>';
    };
    var stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="' + W_NS + '">' +
      "<w:docDefaults><w:rPrDefault><w:rPr>" + rFonts + '<w:color w:val="111111"/><w:sz w:val="' + halfPts + '"/><w:szCs w:val="' + halfPts + '"/>' +
      (charSpace ? '<w:spacing w:val="' + charSpace + '"/>' : "") + '<w:lang w:val="en-AU" w:eastAsia="en-AU" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="' + after + '" w:line="' + lineVal + '" w:lineRule="auto"/><w:jc w:val="left"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      heading(1, 1.6) + heading(2, 1.35) + heading(3, 1.15) +
      '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>' +
      '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
      "</w:styles>";
    var settingsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings xmlns:w="' + W_NS + '">' + (s.tint !== "none" ? "<w:displayBackgroundShape/>" : "") +
      '<w:defaultTabStop w:val="567"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>';
    var footerXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr xmlns:w="' + W_NS + '" xmlns:r="' + R_NS + '"><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr>' +
      textRuns("Page ", "") + '<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>';

    var docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
      (s.pageNumbers ? '<Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' : "") +
      media.map(function (m) { return '<Relationship Id="' + m.rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + m.name + '"/>'; }).join("") +
      "</Relationships>";
    var exts = {};
    media.forEach(function (m) { exts[m.name.split(".").pop()] = true; });
    var mimeOf = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", emf: "image/x-emf", wmf: "image/x-wmf", tif: "image/tiff", tiff: "image/tiff", svg: "image/svg+xml", wdp: "image/vnd.ms-photo" };
    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      Object.keys(exts).map(function (e) { return '<Default Extension="' + e + '" ContentType="' + (mimeOf[e] || "application/octet-stream") + '"/>'; }).join("") +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
      (s.pageNumbers ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : "") +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
    var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>';
    var now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    var core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      "<dc:title>" + escXml(title) + "</dc:title><dc:creator>Adjust Me</dc:creator>" +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + now + "</dcterms:modified></cp:coreProperties>";

    var enc = function (t) { return fflate.strToU8(t); };
    var zipFiles = {
      "[Content_Types].xml": enc(contentTypes),
      "_rels/.rels": enc(rootRels),
      "docProps/core.xml": enc(core),
      "word/document.xml": enc(documentXml),
      "word/styles.xml": enc(stylesXml),
      "word/settings.xml": enc(settingsXml),
      "word/_rels/document.xml.rels": enc(docRels)
    };
    if (s.pageNumbers) zipFiles["word/footer1.xml"] = enc(footerXml);
    media.forEach(function (m) { zipFiles["word/media/" + m.name] = [m.data, { level: 0 }]; });
    return fflate.zipSync(zipFiles, { level: 6 });
  }

  // ------------------------------------------------------------------ UI

  var renderTimer = null;
  function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(render, 60); }

  function syncControls() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-key]"), function (c) {
      var k = c.getAttribute("data-key"), v = settings[k];
      if (c.type === "checkbox") c.checked = !!v;
      else c.value = String(v);
    });
    $("kw-wrap").hidden = !settings.keywords;
    $("q-wrap").hidden = !settings.reduce;
    $("space-wrap").hidden = !settings.space;
  }

  function readControl(c) {
    var k = c.getAttribute("data-key");
    if (c.type === "checkbox") settings[k] = c.checked;
    else if (typeof DEFAULTS[k] === "number") settings[k] = +c.value;
    else settings[k] = c.value;
  }

  function renderQuestions() {
    var list = $("q-list");
    list.innerHTML = "";
    if (!current) return;
    var qs = current.questions;
    $("q-count").textContent = qs.length
      ? qs.length + " question" + (qs.length === 1 ? "" : "s") + " found. Untick the ones to leave out."
      : "No numbered questions were found in this document, so there is nothing to reduce.";
    qs.forEach(function (q, i) {
      var li = el("li"), lab = el("label"), cb = el("input");
      cb.type = "checkbox";
      cb.checked = current.keep[i] !== false;
      cb.addEventListener("change", function () { current.keep[i] = cb.checked; span.className = cb.checked ? "" : "off"; scheduleRender(); });
      var span = el("span", cb.checked ? "" : "off", (q.num ? q.num + " " : "") + (q.text.length > 90 ? q.text.slice(0, 88) + "\u2026" : q.text));
      lab.appendChild(cb); lab.appendChild(span); li.appendChild(lab); list.appendChild(li);
    });
  }

  function render() {
    if (!current) return;
    var res = adjust(current, settings);
    var paper = $("paper");
    paper.style.setProperty("--fs", settings.size + "pt");
    paper.style.setProperty("--lh", String(settings.lineSpacing));
    paper.style.setProperty("--ls", settings.letterSpacing + "em");
    paper.style.setProperty("--ws", (settings.letterSpacing * 2.5) + "em");
    paper.style.setProperty("--pa", Math.max(6, settings.size * 0.7) + "pt");
    var tint = TINTS[settings.tint] || "#ffffff";
    paper.style.setProperty("--tint", tint);
    paper.style.fontFamily = fontStack(settings.font);
    paper.classList.toggle("wide-pre", !!(settings.checklist || settings.icons));
    document.documentElement.style.setProperty("--print-tint", tint);
    paper.innerHTML = res.blocks.map(function (b) { return blockHtml(b, settings, current.images); }).join("") +
      (res.blocks.length ? "" : '<p class="pnote">Nothing to show.</p>');
    fitPaper();

    var dyn = $("print-dyn");
    if (!dyn) { dyn = document.createElement("style"); dyn.id = "print-dyn"; document.head.appendChild(dyn); }
    dyn.textContent = "@media print { @page { background: " + tint + ";" +
      (settings.pageNumbers ? ' @bottom-center { content: "Page " counter(page); font: 9pt Arial, sans-serif; color: #555; }' : "") + " } }";

    var notes = [];
    if (settings.simplify) notes.push("Simpler words: " + res.stats.words + " change" + (res.stats.words === 1 ? "" : "s") + (res.stats.splits ? ", " + res.stats.splits + " long sentence" + (res.stats.splits === 1 ? "" : "s") + " split" : "") + ". These follow fixed rules, so read them through.");
    if (settings.reduce && current.questions.length) notes.push((current.questions.length - res.stats.removed) + " of " + current.questions.length + " questions kept.");
    if (settings.keywords && !parseKeywords(settings.keywordText).length) notes.push("Type some key words to show the key words box.");
    if ((settings.boxes || settings.onePerPage || settings.space || settings.checklist) && !current.questions.length) notes.push("No numbered questions were found, so the question options have nothing to work on.");
    current.warnings.forEach(function (w) { notes.push(w); });
    var n = $("notes");
    n.textContent = notes.join(" ");
    n.className = "msg" + (current.warnings.length ? " warn" : "");
    current.lastAdjusted = res;
  }

  function fitPaper() {
    var paper = $("paper"), box = $("paper-scroll");
    paper.style.zoom = "";
    var avail = box.clientWidth - 4, w = paper.offsetWidth;
    if (w && avail && avail < w) paper.style.zoom = String(Math.max(0.4, avail / w));
  }

  function setBusy(on, text) {
    $("busy").hidden = !on;
    if (text) $("busy-text").textContent = text;
  }

  function showLoadMsg(text, kind) {
    var m = $("load-msg");
    m.textContent = text || "";
    m.className = "msg" + (kind ? " " + kind : "");
  }

  function useDoc(name, kind, parsed) {
    var questions = detectQuestions(parsed.blocks);
    current = { name: name, kind: kind, blocks: parsed.blocks, images: parsed.images, warnings: parsed.warnings || [], questions: questions, keep: questions.map(function () { return true; }) };
    if (!parsed.blocks.length) throw new Error("No text was found in this document.");
    $("file-name").textContent = name;
    $("load-step").hidden = true;
    $("work").hidden = false;
    renderQuestions();
    syncControls();
    render();
    window.scrollTo(0, 0);
  }

  async function loadFile(file) {
    if (!file) return;
    var name = file.name || "document";
    var ext = (name.split(".").pop() || "").toLowerCase();
    showLoadMsg("");
    if (ext === "gdoc") { showLoadMsg("This is a shortcut to a Google Doc, which lives online. Open it in Google Docs, choose File \u2192 Download \u2192 Microsoft Word (.docx), then load that file.", "err"); return; }
    if (ext === "doc" || ext === "odt" || ext === "rtf" || ext === "pages") { showLoadMsg("Adjust Me reads .docx and .pdf files. Open this file in Word (or Pages/LibreOffice) and save it as a Word Document (.docx) first.", "err"); return; }
    if (file.size > 60 * 1024 * 1024) { showLoadMsg("This file is very large (over 60 MB). Try a smaller copy, for example with fewer or smaller pictures.", "err"); return; }
    setBusy(true, "Reading " + name + "\u2026");
    try {
      var u8 = new Uint8Array(await file.arrayBuffer());
      var isPdf = u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46;
      var isZip = u8[0] === 0x50 && u8[1] === 0x4b;
      var parsed;
      if (isPdf) parsed = await parsePdf(u8);
      else if (isZip) parsed = parseDocx(u8);
      else throw new Error("Adjust Me reads Word (.docx) and PDF files. This file is a different type.");
      useDoc(name, isPdf ? "pdf" : "docx", parsed);
    } catch (e) {
      showLoadMsg((e && e.message) || "Something went wrong reading that file.", "err");
      if (window.console) console.error(e);
    } finally {
      setBusy(false);
      $("file").value = "";
    }
  }

  function outName(ext) {
    var base = (current && current.name ? current.name : "document").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "").trim() || "document";
    return base + " (adjusted)." + ext;
  }

  function download(bytes, name, mime) {
    var blob = new Blob([bytes], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name; a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }

  function applyPreset(name) {
    if (name === "reset") {
      var keepKw = settings.keywordText;
      settings = Object.assign({}, DEFAULTS, { keywordText: keepKw });
    } else {
      Object.assign(settings, PRESETS[name] || {});
    }
    if (settings.reduce && current && current.questions.length && current.keep.every(function (k) { return k !== false; })) {
      current.keep = current.questions.map(function (_, i) { return i < Math.ceil(current.questions.length / 2); });
      renderQuestions();
    }
    saveSettings();
    syncControls();
    render();
  }

  function init() {
    syncControls();
    Array.prototype.forEach.call(document.querySelectorAll("[data-key]"), function (c) {
      var ev = c.tagName === "TEXTAREA" ? "input" : "change";
      c.addEventListener(ev, function () {
        readControl(c);
        if (c.getAttribute("data-key") === "reduce" && settings.reduce && current && current.questions.length && current.keep.every(function (k) { return k !== false; })) {
          current.keep = current.questions.map(function (_, i) { return i < Math.ceil(current.questions.length / 2); });
          renderQuestions();
        }
        saveSettings();
        syncControls();
        scheduleRender();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-preset]"), function (b) {
      b.addEventListener("click", function () { applyPreset(b.getAttribute("data-preset")); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-keep]"), function (b) {
      b.addEventListener("click", function () {
        if (!current) return;
        var mode = b.getAttribute("data-keep"), n = current.questions.length;
        current.keep = current.questions.map(function (_, i) {
          return mode === "all" ? true : mode === "half" ? i < Math.ceil(n / 2) : i % 2 === 0;
        });
        renderQuestions();
        render();
      });
    });
    $("kw-suggest").addEventListener("click", function () {
      if (!current) return;
      var have = parseKeywords(settings.keywordText).map(function (i) { return i[0].toLowerCase(); });
      var add = suggestKeywords(current).filter(function (w) { return have.indexOf(w) < 0; });
      settings.keywordText = (settings.keywordText.trim() ? settings.keywordText.trim() + "\n" : "") + add.join("\n");
      syncControls();
      render();
    });

    var input = $("file"), drop = $("drop");
    input.addEventListener("change", function () { loadFile(input.files && input.files[0]); });
    ["dragenter", "dragover"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
    drop.addEventListener("drop", function (e) { var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; loadFile(f); });
    // Dropping a file anywhere else shouldn't open it in the browser.
    window.addEventListener("dragover", function (e) { e.preventDefault(); });
    window.addEventListener("drop", function (e) { e.preventDefault(); if (!$("work").hidden && e.dataTransfer && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });

    $("sample-btn").addEventListener("click", function () { useDoc("Sample - The Water Cycle.docx", "sample", sampleDoc()); });
    $("restart-btn").addEventListener("click", function () {
      current = null;
      $("paper").innerHTML = "";
      $("work").hidden = true;
      $("load-step").hidden = false;
      showLoadMsg("");
    });
    $("dl-docx").addEventListener("click", function () {
      if (!current) return;
      try {
        var res = adjust(current, settings);
        var bytes = buildDocx(res.blocks, settings, current.images, outName("docx").replace(/\.docx$/, ""));
        download(bytes, outName("docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      } catch (e) {
        if (window.console) console.error(e);
        $("notes").textContent = "Sorry, the Word file couldn't be made: " + (e.message || e);
        $("notes").className = "msg err";
      }
    });
    $("print-btn").addEventListener("click", function () {
      var old = document.title;
      document.title = outName("pdf").replace(/\.pdf$/, "");
      window.print();
      setTimeout(function () { document.title = old; }, 1000);
    });
    $("forget-btn").addEventListener("click", function () {
      try { window.localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
      var keepKw = settings.keywordText;
      settings = Object.assign({}, DEFAULTS, { keywordText: keepKw });
      syncControls();
      render();
      $("notes").textContent = "Saved choices forgotten. Everything is back to the starting settings.";
      $("notes").className = "msg";
    });
    window.addEventListener("resize", function () { if (current) fitPaper(); });
    window.addEventListener("beforeprint", function () { $("paper").style.zoom = ""; });
    window.addEventListener("afterprint", function () { if (current) fitPaper(); });
  }

  // Exposed for the automated tests only (no network, no side effects).
  window.AdjustMe = {
    version: VERSION, parseDocx: parseDocx, parsePdf: parsePdf, adjust: adjust, buildDocx: buildDocx,
    detectQuestions: detectQuestions, sampleDoc: sampleDoc, simplifyRuns: simplifyRuns, sentenceStarts: sentenceStarts,
    useDoc: useDoc, settings: function () { return settings; }, current: function () { return current; }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
