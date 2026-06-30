import base64
import re
import io
import struct
import sys
from PIL import Image

def compress_webp(b64_data, quality=65):
    raw = base64.b64decode(b64_data)
    img = Image.open(io.BytesIO(raw))
    out = io.BytesIO()
    img.save(out, format='WEBP', quality=quality, method=6)
    new_raw = out.getvalue()
    new_b64 = base64.b64encode(new_raw).decode('ascii')
    return new_b64 if len(new_b64) < len(b64_data) else b64_data

def downsample_wav(b64_data):
    """Reduce WAV to mono 22050 Hz 16-bit."""
    raw = base64.b64decode(b64_data)
    f = io.BytesIO(raw)
    # Parse WAV header
    riff, size, wave = struct.unpack('<4sI4s', f.read(12))
    if riff != b'RIFF' or wave != b'WAVE':
        return b64_data
    # Read chunks
    chunks = {}
    while True:
        header = f.read(8)
        if len(header) < 8:
            break
        chunk_id, chunk_size = struct.unpack('<4sI', header)
        chunk_data = f.read(chunk_size)
        if chunk_size % 2 == 1:
            f.read(1)
        chunks[chunk_id] = chunk_data
    if b'fmt ' not in chunks or b'data' not in chunks:
        return b64_data
    fmt = chunks[b'fmt ']
    audio_format, num_channels, sample_rate, byte_rate, block_align, bits_per_sample = struct.unpack('<HHIIHH', fmt[:16])
    if audio_format != 1:  # Only handle PCM
        return b64_data
    audio_data = chunks[b'data']
    # Convert bytes to samples
    if bits_per_sample == 16:
        fmt_char = 'h'
        sample_size = 2
    elif bits_per_sample == 8:
        fmt_char = 'B'
        sample_size = 1
    else:
        return b64_data
    total_samples = len(audio_data) // sample_size
    samples = list(struct.unpack(f'<{total_samples}{fmt_char}', audio_data))
    # Mix to mono if stereo
    if num_channels == 2:
        mono = []
        for i in range(0, len(samples) - 1, 2):
            avg = (samples[i] + samples[i+1]) // 2
            mono.append(avg)
        samples = mono
        num_channels = 1
    # Downsample from original rate to 22050 if higher
    new_rate = min(sample_rate, 22050)
    if sample_rate > new_rate:
        ratio = sample_rate / new_rate
        new_samples = []
        i = 0.0
        while int(i) < len(samples):
            new_samples.append(samples[int(i)])
            i += ratio
        samples = new_samples
    # Write new WAV
    out = io.BytesIO()
    new_bits = 16
    new_block_align = num_channels * (new_bits // 8)
    new_byte_rate = new_rate * num_channels * (new_bits // 8)
    new_audio = struct.pack(f'<{len(samples)}h', *[max(-32768, min(32767, s)) for s in samples])
    fmt_chunk = struct.pack('<HHIIHH', 1, num_channels, new_rate, new_byte_rate, new_block_align, new_bits)
    out.write(b'RIFF')
    total_size = 4 + 8 + len(fmt_chunk) + 8 + len(new_audio)
    out.write(struct.pack('<I', total_size))
    out.write(b'WAVE')
    out.write(b'fmt ')
    out.write(struct.pack('<I', len(fmt_chunk)))
    out.write(fmt_chunk)
    out.write(b'data')
    out.write(struct.pack('<I', len(new_audio)))
    out.write(new_audio)
    new_b64 = base64.b64encode(out.getvalue()).decode('ascii')
    return new_b64 if len(new_b64) < len(b64_data) else b64_data

def remove_font_from_inner_html(inner_html):
    # Find and remove @font-face block with embedded font data
    start = inner_html.find('@font-face')
    if start == -1:
        return inner_html
    brace_start = inner_html.find('{', start)
    if brace_start == -1:
        return inner_html
    brace_end = inner_html.find('}', brace_start)
    if brace_end == -1:
        return inner_html
    # Remove the @font-face block
    result = inner_html[:start] + inner_html[brace_end+1:]
    # Replace font-family references with system font
    result = result.replace('"SipDateFont"', '"system-ui, sans-serif"')
    result = result.replace("'SipDateFont'", "'system-ui, sans-serif'")
    return result

def remove_unused_video_assets(content, video_asset_names):
    total_removed = 0
    for name in video_asset_names:
        escaped = re.escape(name)
        pattern = rf',"{escaped}":\{{"src":"data:video/mp4;base64,[^"]+","w":\d+,"h":\d+,"kind":"video"\}}'
        before = len(content)
        content = re.sub(pattern, '', content)
        removed = before - len(content)
        if removed > 0:
            print(f"  Removed video asset '{name}': -{removed/1024:.1f} KB")
        else:
            print(f"  WARNING: video asset '{name}' not found or pattern mismatch")
    return content

def process_file(input_path, output_path, unused_video_names):
    print(f"\n=== Processing: {input_path} ===")
    with open(input_path, 'r', encoding='utf-8') as f:
        content = f.read()
    original_size = len(content)
    print(f"Original size: {original_size/1024/1024:.2f} MB")

    # Step 1: Remove unused outer video assets
    print("\n[Step 1] Removing unused outer video assets...")
    content = remove_unused_video_assets(content, unused_video_names)
    print(f"  After: {len(content)/1024/1024:.2f} MB")

    # Step 2: Recompress WebP images
    print("\n[Step 2] Recompressing WebP images...")
    total_img_savings = 0
    def recompress_webp_match(m):
        nonlocal total_img_savings
        orig = m.group(1)
        new_b64 = compress_webp(orig, quality=65)
        total_img_savings += len(orig) - len(new_b64)
        return f'"data:image/webp;base64,{new_b64}"'
    content = re.sub(r'"data:image/webp;base64,([^"]+)"', recompress_webp_match, content)
    print(f"  Image savings: -{total_img_savings/1024:.1f} KB")
    print(f"  After: {len(content)/1024/1024:.2f} MB")

    # Step 3: Downsample WAV audio
    print("\n[Step 3] Downsampling WAV audio...")
    def downsample_wav_match(m):
        orig = m.group(1)
        new_b64 = downsample_wav(orig)
        saved = len(orig) - len(new_b64)
        if saved > 0:
            print(f"  WAV savings: -{saved/1024:.1f} KB")
        return f'"data:audio/wav;base64,{new_b64}"'
    content = re.sub(r'"data:audio/wav;base64,([^"]+)"', downsample_wav_match, content)
    print(f"  After: {len(content)/1024/1024:.2f} MB")

    # Step 4: Decode inner HTML, remove font, re-encode
    print("\n[Step 4] Reducing inner HTML end card...")
    html_match = re.search(r'"data:text/html;base64,([^"]+)"', content)
    if html_match:
        inner_b64 = html_match.group(1)
        try:
            inner_bytes = base64.b64decode(inner_b64)
            inner_html = inner_bytes.decode('utf-8')
            print(f"  Decoded inner HTML: {len(inner_html)/1024:.1f} KB")
            before_font = len(inner_html)
            inner_html = remove_font_from_inner_html(inner_html)
            print(f"  Font removed: -{(before_font - len(inner_html))/1024:.1f} KB from decoded HTML")
            new_inner_b64 = base64.b64encode(inner_html.encode('utf-8')).decode('ascii')
            outer_savings = len(inner_b64) - len(new_inner_b64)
            print(f"  Outer file savings: -{outer_savings/1024:.1f} KB")
            content = content.replace(
                f'"data:text/html;base64,{inner_b64}"',
                f'"data:text/html;base64,{new_inner_b64}"'
            )
        except Exception as e:
            print(f"  ERROR processing inner HTML: {e}")
    print(f"  After: {len(content)/1024/1024:.2f} MB")

    final_size = len(content)
    print(f"\n=== Results ===")
    print(f"Original: {original_size/1024/1024:.2f} MB")
    print(f"Final:    {final_size/1024/1024:.2f} MB")
    print(f"Saved:    {(original_size-final_size)/1024/1024:.2f} MB ({100*(original_size-final_size)/original_size:.1f}%)")

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"Written to: {output_path}")
    return final_size

# Process Orivelle
orivelle_videos = [
    "orivelle_acslanot_sip_20260624_01_emily_product_card_human_none_portrait",
    "orivelle_acslanot_sip_20260624_01_emily_product_card_human_none_landscape",
]
process_file(
    r"c:\Users\Aundreka\Downloads\ems\Orivelle_MIP1_al.html",
    r"c:\Users\Aundreka\Downloads\ems\Orivelle_MIP1_al.html",
    orivelle_videos
)

# Process EMS
ems_videos = [
    "emsense_acslanot_sip_20260624_01_emily_product_video_human_none_landscape",
    "emsense_acslanot_sip_20260624_01_emily_product_video_human_none_portrait",
]
process_file(
    r"c:\Users\Aundreka\Downloads\ems\EMS_MIP1_al.html",
    r"c:\Users\Aundreka\Downloads\ems\EMS_MIP1_al.html",
    ems_videos
)
