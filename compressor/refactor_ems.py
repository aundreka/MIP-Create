"""
For EMS: Move the inline video data from the inner HTML's script
to window.PA_ASSETS in the outer file, then have the iframe reference them
via window.parent.PA_ASSETS (possible because srcdoc iframes are same-origin).

Net savings: ~1059 KB (move 3177 KB of video out of double-base64 encoding).
"""
import base64
import re

PORTRAIT_ID = "emsense_acslanot_sip_20260624_01_emily_product_video_human_none_portrait"
LANDSCAPE_ID = "emsense_acslanot_sip_20260624_01_emily_product_video_human_none_landscape"

with open(r"c:\Users\Aundreka\Downloads\ems\EMS_MIP1_al.html", 'r', encoding='utf-8') as f:
    content = f.read()

print(f"Starting size: {len(content)/1024/1024:.2f} MB")

# Step 1: Extract video base64 data from inner HTML
scripts = re.findall(r'<script[^>]*>([\s\S]*?)</script>', content)
big_script = scripts[1]  # The PA_PROJECT+PA_ASSETS script

html_match = re.search(r'"data:text/html;base64,([^"]+)"', big_script)
inner_b64 = html_match.group(1)
inner_bytes = base64.b64decode(inner_b64)
inner_html = inner_bytes.decode('utf-8')

# Find srcPortrait and srcLandscape variable declarations
portrait_m = re.search(r'const srcPortrait\s*=\s*"(data:video/mp4;base64,[^"]+)"', inner_html)
landscape_m = re.search(r'const srcLandscape\s*=\s*"(data:video/mp4;base64,[^"]+)"', inner_html)

if not portrait_m or not landscape_m:
    print("ERROR: Could not find srcPortrait or srcLandscape in inner HTML")
    exit(1)

portrait_src = portrait_m.group(1)  # "data:video/mp4;base64,XXXX"
landscape_src = landscape_m.group(1)
portrait_b64 = portrait_src.split(',', 1)[1]
landscape_b64 = landscape_src.split(',', 1)[1]

print(f"Portrait video: {len(portrait_b64)/1024:.1f} KB base64")
print(f"Landscape video: {len(landscape_b64)/1024:.1f} KB base64")

# Determine video dimensions (estimate from base64 size)
# Portrait: taller, Landscape: wider
p_w, p_h = 1080, 1920
l_w, l_h = 1920, 1080

# Step 2: Add video assets back to PA_ASSETS in outer file
# Find the PA_ASSETS object and insert videos before the text/html SIP entry
sip_key = '"sip-date-20260625-1917"'
sip_idx = content.find(sip_key)
if sip_idx == -1:
    # Try alternate format
    sip_idx = content.find('"sip-')
    if sip_idx == -1:
        print("ERROR: Cannot find SIP asset in PA_ASSETS")
        exit(1)
    print(f"Found SIP at {sip_idx}: {content[sip_idx:sip_idx+50]}")

# Insert before the SIP key (there should be a comma before it)
# The format is: ...,  "prev_asset": {...}, "sip-date-...": {"src":...}
# We need to insert: ,"portrait_id": {...}, "landscape_id": {...},

portrait_entry = f'"{PORTRAIT_ID}":{{"src":"{portrait_src}","w":{p_w},"h":{p_h},"kind":"video"}},'
landscape_entry = f'"{LANDSCAPE_ID}":{{"src":"{landscape_src}","w":{l_w},"h":{l_h},"kind":"video"}},'

# Insert these entries right before the SIP key
content = content[:sip_idx] + portrait_entry + landscape_entry + content[sip_idx:]

print(f"\nAfter adding videos to PA_ASSETS: {len(content)/1024/1024:.2f} MB")

# Step 3: Modify inner HTML script - replace inline videos with parent references
portrait_ref = f'window.parent.PA_ASSETS["{PORTRAIT_ID}"].src'
landscape_ref = f'window.parent.PA_ASSETS["{LANDSCAPE_ID}"].src'

# Replace const srcPortrait = "data:video/mp4;base64,..." with parent reference
new_inner = re.sub(
    r'const srcPortrait\s*=\s*"data:video/mp4;base64,[^"]+";',
    f'const srcPortrait = (window.parent && window.parent.PA_ASSETS && window.parent.PA_ASSETS["{PORTRAIT_ID}"]) ? {portrait_ref} : "";',
    inner_html
)
new_inner = re.sub(
    r'const srcLandscape\s*=\s*"data:video/mp4;base64,[^"]+";',
    f'const srcLandscape = (window.parent && window.parent.PA_ASSETS && window.parent.PA_ASSETS["{LANDSCAPE_ID}"]) ? {landscape_ref} : "";',
    new_inner
)

vid_removed = inner_html.count('data:video/mp4;base64,') - new_inner.count('data:video/mp4;base64,')
print(f"\nVideos removed from inner HTML: {vid_removed}")
print(f"Inner HTML before: {len(inner_html)/1024:.1f} KB")
print(f"Inner HTML after:  {len(new_inner)/1024:.1f} KB")
print(f"Inner HTML savings: {(len(inner_html)-len(new_inner))/1024:.1f} KB decoded")

# Re-encode inner HTML
new_inner_b64 = base64.b64encode(new_inner.encode('utf-8')).decode('ascii')
print(f"New inner HTML base64: {len(new_inner_b64)/1024:.1f} KB (was {len(inner_b64)/1024:.1f} KB)")
outer_savings = len(inner_b64) - len(new_inner_b64)
print(f"Outer file savings from inner HTML reduction: {outer_savings/1024:.1f} KB")

# Replace in content (content already has updated PA_ASSETS from step 2)
# Need to find and replace the text/html base64 blob
# Note: content has already been modified with the new PA_ASSETS entries
content = content.replace(
    f'"data:text/html;base64,{inner_b64}"',
    f'"data:text/html;base64,{new_inner_b64}"'
)

print(f"\nFinal size: {len(content)/1024/1024:.2f} MB")

with open(r"c:\Users\Aundreka\Downloads\ems\EMS_MIP1_al.html", 'w', encoding='utf-8') as f:
    f.write(content)

print("Written successfully!")
