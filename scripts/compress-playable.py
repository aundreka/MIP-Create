#!/usr/bin/env python3
"""
compress-playable.py  --  Post-process a single-file playable HTML to fit under 5 MB.

Strategies applied automatically (no hardcoded asset names needed):

  1. Remove unused outer video assets  (~3 MB saving).  Portrait/landscape video files
     are often uploaded to the editor AND embedded inside the SIP end-card's inner HTML;
     the outer copies in PA_ASSETS are redundant if no element references them.
  2. Strip base64-embedded @font-face blocks from the inner HTML end card.
  3. Recompress WebP images at lower quality  (requires Pillow; skipped if not installed)
  4. Downsample WAV audio to 22050 Hz mono via proper RIFF chunk-based decimation.

Usage:
  python compress-playable.py file.html [file2.html ...]
  python compress-playable.py bugs/*.html -o bugs/compressed/
"""

import argparse, base64, io, json, re, struct, sys, wave
from pathlib import Path

MAX_BYTES = 5 * 1024 * 1024


# ---------------------------------------------------------------------------
# Asset-level transforms  (operate on base64 strings, return base64 strings)
# ---------------------------------------------------------------------------

def compress_webp(b64: str, quality: int = 65) -> str:
    try:
        from PIL import Image
    except ImportError:
        return b64
    raw = base64.b64decode(b64)
    img = Image.open(io.BytesIO(raw))
    buf = io.BytesIO()
    img.save(buf, format='WEBP', quality=quality, method=6)
    new_b64 = base64.b64encode(buf.getvalue()).decode('ascii')
    return new_b64 if len(new_b64) < len(b64) else b64


def downsample_wav(b64: str, target_rate: int = 22050) -> str:
    """Parse WAV chunks, mix to mono if stereo, downsample to target_rate."""
    raw = base64.b64decode(b64)
    f = io.BytesIO(raw)
    riff, _, wav_id = struct.unpack('<4sI4s', f.read(12))
    if riff != b'RIFF' or wav_id != b'WAVE':
        return b64
    chunks: dict[bytes, bytes] = {}
    while True:
        hdr = f.read(8)
        if len(hdr) < 8:
            break
        cid, csz = struct.unpack('<4sI', hdr)
        chunks[cid] = f.read(csz)
        if csz % 2:
            f.read(1)
    if b'fmt ' not in chunks or b'data' not in chunks:
        return b64
    audio_fmt, ch, sr, _, _, bps = struct.unpack('<HHIIHH', chunks[b'fmt '][:16])
    if audio_fmt != 1:  # PCM only
        return b64
    if sr <= target_rate:
        return b64  # already at or below target
    fmt_char = {16: 'h', 8: 'B'}.get(bps)
    if fmt_char is None:
        return b64
    n = len(chunks[b'data']) // (bps // 8)
    samples = list(struct.unpack(f'<{n}{fmt_char}', chunks[b'data']))
    # Mix stereo -> mono
    if ch == 2:
        samples = [(samples[i] + samples[i + 1]) // 2 for i in range(0, len(samples) - 1, 2)]
        ch = 1
    # Decimate
    ratio = sr / target_rate
    new_samples = [samples[int(i * ratio)] for i in range(int(len(samples) / ratio))]
    new_audio = struct.pack(f'<{len(new_samples)}h', *[max(-32768, min(32767, s)) for s in new_samples])
    blk = ch * 2
    fmt_chunk = struct.pack('<HHIIHH', 1, ch, target_rate, target_rate * ch * 2, blk, 16)
    out = io.BytesIO()
    out.write(b'RIFF')
    out.write(struct.pack('<I', 4 + 8 + len(fmt_chunk) + 8 + len(new_audio)))
    out.write(b'WAVE')
    out.write(b'fmt ' + struct.pack('<I', len(fmt_chunk)) + fmt_chunk)
    out.write(b'data' + struct.pack('<I', len(new_audio)) + new_audio)
    new_b64 = base64.b64encode(out.getvalue()).decode('ascii')
    return new_b64 if len(new_b64) < len(b64) else b64


# ---------------------------------------------------------------------------
# Step 1: Remove unused outer video assets
# ---------------------------------------------------------------------------

def _collect_ids(obj, valid_keys: set) -> set:
    """Recursively collect strings from a parsed JSON object that match asset IDs."""
    found: set = set()
    if isinstance(obj, str):
        if obj in valid_keys:
            found.add(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            found |= _collect_ids(v, valid_keys)
    elif isinstance(obj, list):
        for item in obj:
            found |= _collect_ids(item, valid_keys)
    return found


def remove_unused_videos(html: str, log: list[str]) -> str:
    """
    Remove outer PA_ASSETS video entries not referenced anywhere in PA_PROJECT
    OR inside any inner HTML (text/html) asset.
    These are typically the portrait/landscape video files uploaded to the editor
    that are also embedded verbatim inside the SIP end-card's inner HTML — the
    outer copies are redundant and account for the bulk of the file size.
    Uses regex removal on the raw string so multi-MB video data is never
    re-parsed or re-serialised.
    """
    decoder = json.JSONDecoder()

    proj_idx = html.find('window.PA_PROJECT=')
    if proj_idx == -1:
        return html
    try:
        project, _ = decoder.raw_decode(html, idx=proj_idx + len('window.PA_PROJECT='))
    except json.JSONDecodeError:
        return html

    pa_idx = html.find('window.PA_ASSETS=')
    if pa_idx == -1:
        return html
    try:
        assets, _ = decoder.raw_decode(html, idx=pa_idx + len('window.PA_ASSETS='))
    except json.JSONDecodeError:
        return html

    asset_keys = set(assets.keys())

    # IDs referenced in PA_PROJECT (element configs, scene data, etc.)
    used_ids = _collect_ids(project, asset_keys)

    # IDs referenced inside any inner HTML asset (e.g. window.parent.PA_ASSETS["key"])
    for v in assets.values():
        src: str = v.get('src', '')
        if not src.startswith('data:text/html;base64,'):
            continue
        try:
            inner = base64.b64decode(src.split(',', 1)[1]).decode('utf-8', errors='replace')
        except Exception:
            continue
        for ak in asset_keys:
            if f'"{ak}"' in inner or f"'{ak}'" in inner:
                used_ids.add(ak)

    unused = [k for k, v in assets.items()
              if k not in used_ids and v.get('kind') == 'video']
    if not unused:
        return html

    for vid_key in unused:
        esc = re.escape(vid_key)
        before = len(html)
        # typical case: preceded by a comma (not the first entry)
        html = re.sub(
            rf',"{esc}":\{{"src":"data:video/mp4;base64,[A-Za-z0-9+/=]+","w":\d+,"h":\d+,"kind":"video"\}}',
            '', html,
        )
        if len(html) == before:
            # first entry in object: followed by a comma
            html = re.sub(
                rf'"{esc}":\{{"src":"data:video/mp4;base64,[A-Za-z0-9+/=]+","w":\d+,"h":\d+,"kind":"video"\}},',
                '', html,
            )
        saved = before - len(html)
        if saved > 0:
            log.append(f'  removed unused video "{vid_key}"  (-{saved // 1024} KB)')
        else:
            log.append(f'  WARNING: could not remove "{vid_key}" — pattern mismatch')

    return html


# ---------------------------------------------------------------------------
# Step 2: Strip @font-face blocks from inner HTML end cards
# ---------------------------------------------------------------------------

def strip_endcard_fonts(html: str, log: list[str]) -> str:
    def patch(m: re.Match) -> str:
        b64 = m.group(1)
        try:
            inner = base64.b64decode(b64).decode('utf-8')
        except Exception:
            return m.group(0)
        new_inner = re.sub(
            r'@font-face\s*\{[^}]*url\s*\(\s*["\']data:[^"\']+["\']\s*\)[^}]*\}',
            '', inner, flags=re.DOTALL,
        )
        if new_inner == inner:
            return m.group(0)
        new_b64 = base64.b64encode(new_inner.encode('utf-8')).decode('ascii')
        saved_kb = (len(b64) - len(new_b64)) // 1024
        if saved_kb >= 1:
            log.append(f'  endcard: stripped fonts  (-{saved_kb} KB)')
        return f'"data:text/html;base64,{new_b64}"'

    return re.sub(r'"data:text/html;base64,([A-Za-z0-9+/=]+)"', patch, html)


# ---------------------------------------------------------------------------
# Main HTML processor
# ---------------------------------------------------------------------------

def process(html: str) -> tuple[str, list[str]]:
    log: list[str] = []

    # Step 1: Remove outer video assets that aren't used by any element (biggest win)
    html = remove_unused_videos(html, log)

    # Step 2: Strip embedded fonts from inner HTML end cards
    html = strip_endcard_fonts(html, log)

    # Step 3: Recompress WebP images
    webp_saved = 0
    def patch_webp(m: re.Match) -> str:
        nonlocal webp_saved
        orig = m.group(1)
        new_b64 = compress_webp(orig, quality=65)
        webp_saved += len(orig) - len(new_b64)
        return f'"data:image/webp;base64,{new_b64}"'
    html = re.sub(r'"data:image/webp;base64,([A-Za-z0-9+/=]+)"', patch_webp, html)
    if webp_saved > 1024:
        log.append(f'  webp: -{webp_saved // 1024} KB')

    # Step 4: Downsample WAV audio
    def patch_wav(m: re.Match) -> str:
        orig = m.group(1)
        new_b64 = downsample_wav(orig)
        if new_b64 != orig:
            kb = (len(orig) - len(new_b64)) // 1024
            log.append(f'  wav: -{kb} KB')
        return f'"data:audio/wav;base64,{new_b64}"'
    html = re.sub(r'"data:audio/wav;base64,([A-Za-z0-9+/=]+)"', patch_wav, html)

    return html, log


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def fmt(n: int) -> str:
    return f'{n / 1048576:.2f} MB'


def main() -> None:
    ap = argparse.ArgumentParser(description='Compress single-file playable HTML to under 5 MB.')
    ap.add_argument('inputs', nargs='+', metavar='FILE')
    ap.add_argument('-o', '--output-dir', default=None,
                    help='Output directory (default: same dir, _compressed suffix)')
    args = ap.parse_args()

    for path_str in args.inputs:
        p = Path(path_str)
        if not p.exists():
            print(f'SKIP {p}: not found', file=sys.stderr)
            continue

        html = p.read_text(encoding='utf-8')
        before = len(html.encode('utf-8'))

        new_html, log = process(html)
        after = len(new_html.encode('utf-8'))

        out_p = (Path(args.output_dir) / p.name) if args.output_dir else p.with_stem(p.stem + '_compressed')
        out_p.parent.mkdir(parents=True, exist_ok=True)
        out_p.write_text(new_html, encoding='utf-8')

        status = 'OK under 5 MB' if after <= MAX_BYTES else 'WARNING still over 5 MB'
        print(f'\n{p.name}')
        for line in log:
            print(line)
        print(f'  {fmt(before)} -> {fmt(after)}  (saved {fmt(before - after)})  {status}')
        print(f'  -> {out_p}')


if __name__ == '__main__':
    main()
