import { SSHManager } from "../../core/dist/ssh/manager.js";
import path from "path";
import os from "os";
import fs from "fs";
import yaml from "js-yaml";

const cfg = yaml.load(
  fs.readFileSync("C:/Users/Yuval/.stremio-addon-manager/addons/my-private-addon/config.yaml", "utf8")
);
const t = cfg.installation.target;
const torboxToken = cfg.secrets.torboxToken;
const ssh = new SSHManager({
  host: t.host,
  port: t.port,
  username: t.username,
  privateKeyPath: path.join(os.homedir(), ".ssh", "id_rsa"),
});
await ssh.connect();

const remoteScript = `
python3 - <<'PY'
import json, urllib.request, urllib.parse, os

# Cinemeta absolute index
meta = json.load(urllib.request.urlopen("https://v3-cinemeta.strem.io/meta/series/tt0409591.json", timeout=15))["meta"]
videos = meta["videos"]
ordered = sorted([v for v in videos if (v.get("season") or 0) > 0], key=lambda v: (v["season"], v["episode"]))
abs_map = {}
for i, v in enumerate(ordered, start=1):
    abs_map[(v["season"], v["episode"])] = i
print("S3E40 absolute among seasons>0:", abs_map.get((3,40)))
for s in range(1,6):
    eps = [v for v in videos if v.get("season")==s]
    print(f"S{s}: {len(eps)} eps ({eps[0]['episode']}-{eps[-1]['episode']})" if eps else f"S{s}: 0")

tio = json.load(open("/tmp/tio-n.json"))
streams = tio.get("streams") or []
first = streams[0]
h = first["infoHash"]
fi = first.get("fileIdx")
print("first hash", h, "fileIdx", fi, "title", (first.get("title") or "").split(chr(10))[0][:80])

token = os.environ["TB"]
url = f"https://api.torbox.app/v1/api/torrents/checkcached?hash={h}&format=object&list_files=true"
req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
data = json.load(urllib.request.urlopen(req, timeout=25)).get("data") or {}
entry = data.get(h) or data.get(h.lower()) or {}
files = entry.get("files") or []
print("torbox files", len(files))
for i, f in enumerate(files):
    name = f.get("name") or ""
    interesting = (
        i in (0,1,2, fi-1 if fi else -1, fi if fi is not None else -1, fi+1 if fi is not None else -1)
        or "movie" in name.lower()
        or "040" in name
        or "S03E40" in name.upper()
        or "E040" in name.upper()
    )
    if interesting:
        print(f"  idx={i} id={f.get('id')} size={f.get('size')} name={name[:120]}")

# Also check Judas multi-audio (has EP40 S3 flag earlier idx 8)
for s in streams:
    title = (s.get("title") or "")
    if "Judas" in title and "Multi" in title:
        print("Judas fileIdx", s.get("fileIdx"), title.split(chr(10))[0][:90])
        break
for s in streams:
    title = (s.get("title") or "")
    if "ITA" in title and "Stagione" in title:
        print("ITA fileIdx", s.get("fileIdx"), title.split(chr(10))[0][:90])
        break
PY
`;

const r = await ssh.execCommand(`TB='${torboxToken}' bash -lc ${JSON.stringify(remoteScript)}`);
console.log(r.stdout);
console.log(r.stderr);
await ssh.disconnect();
