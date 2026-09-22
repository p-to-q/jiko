# Jiko appearance-model generator

This directory contains the reproducible source for the current website-derived
Jiko One appearance models. It does **not** describe a production enclosure:
PCB, battery, speaker, antenna, acoustic, thermal, fastener, and connector
keep-outs have not been measured.

Create an isolated environment from the repository root, then generate either
variant:

```sh
python3 -m venv .venv-model
. .venv-model/bin/activate
python -m pip install -r tools/jiko-model/requirements.txt
python tools/jiko-model/generate_jiko_model.py
python tools/jiko-model/generate_jiko_model.py --relief-print
```

The generator writes to `models/jiko-one-hero` and
`models/jiko-one-hero-relief`. Small README/metadata receipts are kept in Git;
reproducible STL, STEP, GLB, and PNG exports are ignored to avoid turning the
source repository into a binary artifact store. Publish or archive a chosen
export separately with a source commit, generator dependency versions, output
hashes, slicer profile, material, and physical fit-test receipt.

`render_previews.py` renders repeatable previews after generation. The model
README files document each variant and its current limitations.
