"""Downloads the F1 car models from Sketchfab (CC BY only), compresses them and records credits.

Usage: SKETCHFAB_TOKEN=... python3 tools/fetch_models.py [model keys...]
"""
import json, os, subprocess, sys, time, urllib.request
TOK = os.environ['SKETCHFAB_TOKEN']  # personal API token from sketchfab.com/settings/password
REPO = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'models')
GT = os.environ.get('GLTF_TRANSFORM', 'gltf-transform')  # npm i -g @gltf-transform/cli
CARS = [
 ('f2002','cf638e7ccd4d42a4bcfdbd4de7eaeddf'),('f2004','827e64acecba4f008759ae30a5bfeecc'),('r25','0d58fe125f5b41a2b8482576723120c4'),('mp4-20','95e5c4c4fc8542bcb98e6b33ecf6c2f2'),
 ('r26','23a73ec3a9234017b393362fc58b6c10'),('f2008','0476bd73b8d84e0e99d5197140bc22d6'),('mp4-23','bf1096b47dab4cefaedb46006125670e'),
 ('bgp001','4c02d48be0104a79b657e732890e6d54'),('rb6','c826a48f888c4a0996ef9ca57e69d050'),('f2012','a2d73741f6fc4357bd508297d084f909'),('mp4-26','90c7cc319392442c97beb5b968657476'),
 ('w05','4a6e8e56d3554a339ea2ce0860bf08e9'),('rb10','dc2372e6510340c7a58efe91b8afcbfd'),('mp4-31','9ae094da549849659a5964f6a6baf0aa'),
 ('sf71h','e54b896bd21f478f8309eecf3726700e'),('rb14','65e1f548c47247cd932d2c751c413601'),('rs18','36ff37c900c8472c98da40a7f7256fc7'),
 ('rb19','e4afe46f3aab4b23a418da06fc163821'),('rb20','4315ff70ec694ef0b7ebfb84145ef48c'),('w14','26fda66f3e8a48d5a636056f8a64e299'),('mcl39','c6194270002b401bb25be7e35ab56e34'),('sf25','11b53fd8dc324ab7b7fed6b43c62e398'),
 ('w17','b806f1e70aa343219e7158169549b97b'),('mcl40','96214ad5624f42a0861f77008f8d29e7'),('r26audi','32bf228264b047669b100b0f1b8769ac'),('rb22','0a3d24a58e0549d591a5a48c22eec383'),('fw48','4efa51e6d64a4192a83418f1b715c671'),('vf26','1f41e03886724bc6acd16c92402989bc'),
]
def get(url, auth=False):
    h = {'User-Agent': 'pitwall-build'}
    if auth: h['Authorization'] = 'Token ' + TOK
    return urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=120)
CREDITS = os.path.join(REPO, '..', 'data', 'model-credits.json')
credits = json.load(open(CREDITS)) if os.path.exists(CREDITS) else {}
only = sys.argv[1:]
for key, uid in CARS:
    if only and key not in only: continue
    out = f'{REPO}/{key}.glb'
    if os.path.exists(out) and key in credits: continue
    info = json.load(get(f'https://api.sketchfab.com/v3/models/{uid}'))
    lic = (info.get('license') or {}).get('label', '')
    if lic not in ('CC Attribution', 'CC0 Public Domain'):
        print('SKIP license', key, lic); continue
    links = json.load(get(f'https://api.sketchfab.com/v3/models/{uid}/download', auth=True))
    raw = f'{key}.raw.glb'
    with get(links['glb']['url']) as r, open(raw, 'wb') as f: f.write(r.read())
    extra = ['--simplify', 'true', '--simplify-ratio', '0.3', '--simplify-error', '0.0008'] if key == 'mcl39' else []
    res = subprocess.run([GT, 'optimize', raw, out, '--compress', 'quantize', '--texture-compress', 'webp', '--texture-size', '1024'] + extra, capture_output=True, text=True)
    if res.returncode: print('FAIL', key, res.stderr[-400:]); continue
    os.remove(raw)
    credits[key] = {'name': info['name'], 'author': info['user']['displayName'], 'authorUrl': info['user']['profileUrl'], 'url': info['viewerUrl'], 'license': lic, 'licenseUrl': 'https://creativecommons.org/licenses/by/4.0/'}
    json.dump(credits, open(CREDITS, 'w'), ensure_ascii=False, indent=1)
    print(key, info['name'], lic, round(os.path.getsize(out) / 1e6, 2), 'MB', flush=True)
    time.sleep(1)
