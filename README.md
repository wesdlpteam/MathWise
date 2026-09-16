# MathWISE

A mathematics tutoring web app for students at Wesley College, Glen Waverley. It covers
MYP (Years 7 to 10), VCE (General, Methods, Specialist) and IB Diploma (AA and AI, SL and HL).

**Live page:** https://wesdlpteam.github.io/MathWise/

## Staff preview, not classroom ready

Read this before sharing the link with anyone.

The page asks each visitor for their own Anthropic API key, which is stored only in that
person's browser. Nothing is billed to the school and no key is published in this repo.
It works this way so one teacher can test the app locally. It is not safe to hand to
students: anyone sharing that browser profile could reuse the stored key. A real classroom
rollout needs a small server that holds the key privately instead of calling Anthropic
straight from the browser.

## What is in here

- `mathwise.html` is the whole app. One self-contained file, no build step, no install.
  Double-click it to run, or open the live page above.
- `index.html` just forwards the live page to `mathwise.html`.
- `ACv9_Mathematics_Years7-10.md` is the Australian Curriculum v9 maths content, used as
  reference while writing the app's teaching prompts.
- `docs/` holds the design specs and build plans for recent features.
- `CLAUDE.md` is the guide for Claude Code when working on this repo.

## What is deliberately not in here

The Cambridge and VCE textbook PDFs and the IB subject guides stay on the author's machine.
They were source material while building the app, not something it loads. The app sends only
the student's question plus the teaching instructions written inside `mathwise.html`. The
`.gitignore` blocks them so they cannot be committed by accident.

## Running it

Open `mathwise.html` in a browser, or serve the folder with any static file server. It uses
KaTeX and Google Fonts from a CDN, so it needs an internet connection.
