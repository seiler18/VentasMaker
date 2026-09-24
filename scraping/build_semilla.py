# Convierte el scraping de treinta.co en la semilla del catálogo propio.
# Salida: ../public/data/catalogo.json (lo lee el front si el backend no está
# configurado, y lo importa el Apps Script con importarSemilla()).
import json, os, re, shutil, unicodedata
p = json.load(open('productos_treinta.json', encoding='utf-8'))

def norm(s):
    return unicodedata.normalize('NFD', s.lower()).encode('ascii', 'ignore').decode()

# El orden importa: gana la primera regla que calce ("Chaqueta de huaso" es
# Típico antes que Chaqueta; "Polera panty" es Polera antes que Panty).
REGLAS = [
    ('Fiestas Patrias y típicos', r'huaso|nortino|mapuche|cueca|chilote|bandera|panuelo|tricolor|bolero|lolo negra'),
    ('Juguetes', r'funko|camion|helicoptero|lego|muneca|puzle|telefono|transforme|squich|sorpresa|sticker|run run|radio|palines|masitas|juguete|caja registradora|llavero'),
    ('Jeans', r'^jeans'),
    ('Poleras y polerones', r'^polera|^poleron|^camisa|^camisola|^blusa|^crop|^chomba|^chompa|^sueter'),
    ('Calzas y pantalones', r'^calza |^calzas|^pantalon|^shorts|^falso'),
    ('Vestidos y faldas', r'^vestido|^falda|^maxi vestido|^midi|^mirna|^solera|^enterito|^yamper|^jamper'),
    ('Chaquetas y abrigos', r'^abrigo|^blazer|^chaqueta|^chaleco'),
    ('Buzos y conjuntos', r'^buzo|^conjunto'),
    ('Panties y calcetines', r'^panty|^calcet|^calzeta|^caseta|^bucanera|^polaina'),
    ('Ropa interior y pijamas', r'^babydol|^body|^calzoncillo|^pillama'),
    ('Accesorios', r'^gorro|bufanda|^guante|^corbata|^chal|^joya|^cinturon|^sombrero'),
]
def categoria(nombre):
    n = norm(nombre.strip())
    for cat, rx in REGLAS:
        if re.search(rx, n):
            return cat
    return 'Otros'

os.makedirs('../public/data', exist_ok=True)
os.makedirs('../public/img', exist_ok=True)
out = []
for i, x in enumerate(sorted(p, key=lambda x: norm(x['name'].strip())), 1):
    img = ''
    if x['imageUrl'] and os.path.exists(f"img/{x['id']}.webp"):
        img = f"img/{x['id']}.webp"
        shutil.copy(f"img/{x['id']}.webp", f"../public/{img}")
    out.append({
        'id': x['id'],
        'sku': f'MK{i:04d}',          # código interno, sirve para etiquetas
        'codigo': '',                 # código de barras del fabricante (Excel)
        'nombre': re.sub(r'\s+', ' ', x['name']).strip(),
        'descripcion': (x['description'] or '').strip(),
        'categoria': categoria(x['name']),
        'precio': int(x['price'] or 0),
        'stock': int(x['stock'] or 0),
        'visible': x['isVisible'] == 1,
        'imagen': img,
    })
json.dump(out, open('../public/data/catalogo.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
from collections import Counter
print(len(out), Counter(o['categoria'] for o in out).most_common())
