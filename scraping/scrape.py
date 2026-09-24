# Descarga el catálogo público de catalogo.treinta.co/monik10 (datos de la propia tienda).
import json, subprocess, os, re, urllib.request, time
STORE="b1858c00-5648-46cd-bf2b-1cbde2385c93"
ACTION="40543b8e804fdd9172d01b3e67327009946c1bac87"
def page(n):
    body=json.dumps([{"storeId":STORE,"page":n,"limit":100}])
    req=urllib.request.Request("https://catalogo.treinta.co/monik10",data=body.encode(),method="POST",
        headers={"Next-Action":ACTION,"Accept":"text/x-component","Content-Type":"text/plain;charset=UTF-8","User-Agent":"Mozilla/5.0"})
    txt=urllib.request.urlopen(req,timeout=60).read().decode("utf-8")
    line=[l for l in txt.split("\n") if l.startswith("1:")][0][2:]
    return json.loads(line)
items=[]; n=1
while True:
    d=page(n); items+=d["data"]; print("page",n,len(d["data"]),{k:v for k,v in d.items() if k!="data"})
    if not d.get("hasNextPage"): break
    n+=1; time.sleep(0.5)
clean=lambda v: None if v=="$undefined" else v
items=[{k:clean(v) for k,v in p.items()} for p in items]
json.dump(items,open("productos_treinta.json","w",encoding="utf-8"),ensure_ascii=False,indent=1)
print("total",len(items))
