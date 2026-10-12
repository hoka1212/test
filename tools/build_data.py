#!/usr/bin/env python3
"""Builds data/circuits.js and data/season.js for the PIT WALL site.

Sources:
  - Circuit layouts (SVG, MIT): https://github.com/julesr0y/f1-circuits-svg
    (mirror: https://github.com/MisterSix2295/f1-circuits-svg)
  - Madring 2026 layout (GeoJSON, MIT): https://github.com/bacinger/f1-circuits
  - Season data: Jolpica F1 API (https://api.jolpi.ca/ergast/f1/)

Requires: pip install svgelements
Usage: python3 tools/build_data.py <f1-circuits-svg dir> <bacinger f1-circuits dir> [season]
"""
import json, math, os, re, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.jolpi.ca/ergast/f1/"

# svg id -> (name, city, country id)
NAMES = {
    "adelaide": ("Аделаида", "Аделаида"), "aida": ("Окаяма", "Аида"),
    "ain-diab": ("Айн-Диаб", "Касабланка"), "aintree": ("Эйнтри", "Ливерпуль"),
    "anderstorp": ("Андерсторп", "Андерсторп"), "austin": ("Трасса Америк", "Остин"),
    "avus": ("АФУС", "Берлин"), "bahrain": ("Сахир", "Сахир"), "baku": ("Баку", "Баку"),
    "brands-hatch": ("Брэндс-Хэтч", "Фокхем"), "bremgarten": ("Бремгартен", "Берн"),
    "buddh": ("Будда", "Большая Нойда"), "buenos-aires": ("Оскар и Хуан Гальвес", "Буэнос-Айрес"),
    "bugatti": ("Бугатти", "Ле-Ман"), "caesars-palace": ("Сизарс-Пэлас", "Лас-Вегас"),
    "catalunya": ("Барселона-Каталунья", "Монмело"), "clermont-ferrand": ("Шарад", "Клермон-Ферран"),
    "dallas": ("Фэйр-Парк", "Даллас"), "detroit": ("Детройт", "Детройт"),
    "dijon": ("Дижон-Пренуа", "Дижон"), "donington": ("Донингтон-Парк", "Лестершир"),
    "east-london": ("Принс-Джордж", "Ист-Лондон"), "estoril": ("Эшторил", "Эшторил"),
    "fuji": ("Фудзи", "Ояма"), "hockenheimring": ("Хоккенхайм", "Хоккенхайм"),
    "hungaroring": ("Хунгароринг", "Будапешт"), "imola": ("Имола", "Имола"),
    "indianapolis": ("Индианаполис", "Индианаполис"), "interlagos": ("Интерлагос", "Сан-Паулу"),
    "istanbul": ("Истанбул Парк", "Стамбул"), "jacarepagua": ("Жакарепагуа", "Рио-де-Жанейро"),
    "jarama": ("Харама", "Мадрид"), "jeddah": ("Джидда", "Джидда"),
    "jerez": ("Херес", "Херес-де-ла-Фронтера"), "kyalami": ("Кьялами", "Мидранд"),
    "las-vegas": ("Лас-Вегас Стрип", "Лас-Вегас"), "long-beach": ("Лонг-Бич", "Лонг-Бич"),
    "lusail": ("Лусаил", "Лусаил"), "madring": ("Мадринг", "Мадрид"),
    "magny-cours": ("Маньи-Кур", "Невер"), "marina-bay": ("Марина-Бэй", "Сингапур"),
    "melbourne": ("Альберт-Парк", "Мельбурн"), "mexico-city": ("Эрманос Родригес", "Мехико"),
    "miami": ("Майами", "Майами"), "monaco": ("Монако", "Монте-Карло"),
    "monsanto": ("Монсанту", "Лиссабон"), "montjuic": ("Монжуик", "Барселона"),
    "montreal": ("Жиль Вильнёв", "Монреаль"), "mont-tremblant": ("Мон-Трамблан", "Мон-Трамблан"),
    "monza": ("Монца", "Монца"), "mosport": ("Моспорт", "Боуманвилл"),
    "mugello": ("Муджелло", "Скарперия"), "nivelles": ("Нивель-Болер", "Нивель"),
    "nurburgring": ("Нюрбургринг", "Нюрбург"), "paul-ricard": ("Поль Рикар", "Ле-Кастелле"),
    "pedralbes": ("Педральбес", "Барселона"), "pescara": ("Пескара", "Пескара"),
    "phoenix": ("Финикс", "Финикс"), "portimao": ("Алгарве", "Портимау"),
    "porto": ("Боавишта", "Порту"), "reims": ("Реймс-Гё", "Реймс"),
    "riverside": ("Риверсайд", "Риверсайд"), "rouen": ("Руан-ле-Эссар", "Руан"),
    "sebring": ("Себринг", "Себринг"), "sepang": ("Сепанг", "Сепанг"),
    "shanghai": ("Шанхай", "Шанхай"), "silverstone": ("Сильверстоун", "Сильверстоун"),
    "sochi": ("Сочи Автодром", "Сочи"), "spa-francorchamps": ("Спа-Франкоршам", "Ставло"),
    "spielberg": ("Ред Булл Ринг", "Шпильберг"), "suzuka": ("Сузука", "Сузука"),
    "valencia": ("Валенсия", "Валенсия"), "watkins-glen": ("Уоткинс-Глен", "Уоткинс-Глен"),
    "yas-marina": ("Яс Марина", "Абу-Даби"), "yeongam": ("Йонам", "Йонам"),
    "zandvoort": ("Зандворт", "Зандворт"), "zeltweg": ("Цельтвег", "Цельтвег"),
    "zolder": ("Зольдер", "Хойсден-Зольдер"),
}

COUNTRIES = {
    "australia": ("Австралия", "AU"), "japan": ("Япония", "JP"), "morocco": ("Марокко", "MA"),
    "united-kingdom": ("Великобритания", "GB"), "sweden": ("Швеция", "SE"),
    "united-states-of-america": ("США", "US"), "germany": ("Германия", "DE"),
    "bahrain": ("Бахрейн", "BH"), "azerbaijan": ("Азербайджан", "AZ"),
    "switzerland": ("Швейцария", "CH"), "india": ("Индия", "IN"), "argentina": ("Аргентина", "AR"),
    "france": ("Франция", "FR"), "spain": ("Испания", "ES"), "south-africa": ("ЮАР", "ZA"),
    "portugal": ("Португалия", "PT"), "hungary": ("Венгрия", "HU"), "italy": ("Италия", "IT"),
    "brazil": ("Бразилия", "BR"), "turkey": ("Турция", "TR"), "saudi-arabia": ("Саудовская Аравия", "SA"),
    "qatar": ("Катар", "QA"), "singapore": ("Сингапур", "SG"), "mexico": ("Мексика", "MX"),
    "monaco": ("Монако", "MC"), "canada": ("Канада", "CA"), "belgium": ("Бельгия", "BE"),
    "malaysia": ("Малайзия", "MY"), "china": ("Китай", "CN"), "russia": ("Россия", "RU"),
    "austria": ("Австрия", "AT"), "united-arab-emirates": ("ОАЭ", "AE"),
    "south-korea": ("Южная Корея", "KR"), "netherlands": ("Нидерланды", "NL"),
}

# Jolpica circuitId -> svg id (only where they differ)
JOLPICA_TO_SVG = {
    "albert_park": "melbourne", "americas": "austin", "boavista": "porto",
    "brands_hatch": "brands-hatch", "charade": "clermont-ferrand", "essarts": "rouen",
    "galvez": "buenos-aires", "george": "east-london", "las_vegas": "caesars-palace",
    "lemans": "bugatti", "long_beach": "long-beach", "losail": "lusail",
    "magny_cours": "magny-cours", "marina_bay": "marina-bay", "okayama": "aida",
    "red_bull_ring": "spielberg", "ricard": "paul-ricard", "rodriguez": "mexico-city",
    "spa": "spa-francorchamps", "tremblant": "mont-tremblant", "vegas": "las-vegas",
    "villeneuve": "montreal", "watkins_glen": "watkins-glen", "yas_marina": "yas-marina",
}

# Known data fixes in the upstream metadata
LAYOUT_ID_FIXES = {"zandvoort": "zandvoort-5"}
SEASON_FIXES = {"aintree-1": "1955,1957,1959,1961-1962", "shanghai-1": "2004-2019,2024-2025"}

GP_RU = {
    "Australian": "Австралии", "Chinese": "Китая", "Japanese": "Японии", "Bahrain": "Бахрейна",
    "Saudi Arabian": "Саудовской Аравии", "Miami": "Майами", "Canadian": "Канады",
    "Monaco": "Монако", "Barcelona": "Барселоны", "Spanish": "Испании", "Austrian": "Австрии",
    "British": "Великобритании", "Belgian": "Бельгии", "Hungarian": "Венгрии",
    "Dutch": "Нидерландов", "Italian": "Италии", "Azerbaijan": "Азербайджана",
    "Singapore": "Сингапура", "United States": "США", "Mexico City": "Мехико",
    "Brazilian": "Бразилии", "São Paulo": "Сан-Паулу", "Las Vegas": "Лас-Вегаса",
    "Qatar": "Катара", "Abu Dhabi": "Абу-Даби", "Emilia Romagna": "Эмилии-Романьи",
}


def gp_ru(name):
    m = re.match(r"(.+?) Grand Prix(?: in (.+))?$", name)
    if not m or m.group(1) not in GP_RU:
        return name
    s = "Гран-при " + GP_RU[m.group(1)]
    if m.group(2):
        s += " (в " + {"Malaysia": "Малайзии"}.get(m.group(2), m.group(2)) + ")"
    return s


def get(path):
    for attempt in range(4):
        try:
            req = urllib.request.Request(API + path, headers={"User-Agent": "pitwall-build/1.0"})
            return json.load(urllib.request.urlopen(req, timeout=60))["MRData"]
        except Exception as e:
            print("retry", path, e, file=sys.stderr)
            time.sleep(2 + attempt * 3)
    raise SystemExit("API unavailable: " + path)


def svg_path(file):
    src = open(file, encoding="utf-8").read()
    paths = re.findall(r'\sd="([^"]+)"', src)
    return normalize(" ".join(p.strip() for p in paths))


def normalize(d):
    """Scale and centre a path into a 460px box inside the 500x500 frame (some upstream files overflow it)."""
    from svgelements import Path, Matrix  # pip install svgelements
    path = Path(d)
    x0, y0, x1, y1 = path.bbox()
    s = 460 / max(x1 - x0, y1 - y0)
    tx = (500 - (x1 - x0) * s) / 2 - x0 * s
    ty = (500 - (y1 - y0) * s) / 2 - y0 * s
    path = path * Matrix(f"matrix({s},0,0,{s},{tx},{ty})")
    path.reify()
    out = path.d()
    return re.sub(r"-?\d+\.\d+", lambda m: f"{float(m.group()):.1f}".rstrip("0").rstrip("."), out)


def geojson_path(file):
    coords = json.load(open(file))["features"][0]["geometry"]["coordinates"]
    lat0 = sum(c[1] for c in coords) / len(coords)
    k = math.cos(math.radians(lat0))
    pts = [(c[0] * k, -c[1]) for c in coords]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    s = 460 / max(w, h)
    ox, oy = (500 - w * s) / 2, (500 - h * s) / 2
    out = [f"{(x - min(xs)) * s + ox:.1f} {(y - min(ys)) * s + oy:.1f}" for x, y in pts]
    return "M" + " L".join(out) + "Z"


def main():
    svg_dir, geo_dir = sys.argv[1], sys.argv[2]
    season = sys.argv[3] if len(sys.argv) > 3 else "current"

    races = get(f"{season}/races/?limit=100")["RaceTable"]
    year = races["season"]
    races = races["Races"]
    cal_ids = {JOLPICA_TO_SVG.get(r["Circuit"]["circuitId"], r["Circuit"]["circuitId"]) for r in races}

    meta = json.load(open(os.path.join(svg_dir, "circuits.json"), encoding="utf-8"))
    meta.append({"id": "madring", "name": "Circuito de Madring", "countryId": "spain",
                 "layouts": [{"layoutId": "madring-1", "seasons": year}]})
    circuits = []
    for c in meta:
        layouts = []
        for i, l in enumerate(c["layouts"]):
            l["layoutId"] = LAYOUT_ID_FIXES.get(l["layoutId"], l["layoutId"])
            seasons = SEASON_FIXES.get(l["layoutId"], l["seasons"])
            last = i == len(c["layouts"]) - 1
            if last and c["id"] in cal_ids and year not in seasons:
                seasons += "," + year
            if l["layoutId"] == "madring-1":
                d = geojson_path(os.path.join(geo_dir, "circuits", "es-2026.geojson"))
            else:
                d = svg_path(os.path.join(svg_dir, "circuits", "black", l["layoutId"] + ".svg"))
            layouts.append({"id": l["layoutId"], "seasons": seasons, "d": d})
        name, city = NAMES[c["id"]]
        country, cc = COUNTRIES[c["countryId"]]
        circuits.append({"id": c["id"], "name": name, "official": c["name"], "city": city,
                         "country": country, "cc": cc, "layouts": layouts})

    with open(os.path.join(ROOT, "data", "circuits.js"), "w", encoding="utf-8") as f:
        f.write("// Generated by tools/build_data.py. Layouts: julesr0y/f1-circuits-svg (MIT), "
                "bacinger/f1-circuits (MIT).\n")
        f.write("window.F1_CIRCUITS = " + json.dumps(circuits, ensure_ascii=False, separators=(",", ":")) + ";\n")

    winners = {r["round"]: r["Results"][0]["Driver"]["code"]
               for r in get(f"{year}/results/1/?limit=100")["RaceTable"]["Races"]}
    ds = get(f"{year}/driverstandings/?limit=100")["StandingsTable"]["StandingsLists"]
    done = int(ds[0]["round"]) if ds else 0
    progression = {}
    for rnd in range(1, done + 1):
        lst = get(f"{year}/{rnd}/driverstandings/?limit=100")["StandingsTable"]["StandingsLists"][0]
        for d in lst["DriverStandings"]:
            progression.setdefault(d["Driver"]["code"], {})[rnd] = float(d["points"])
        time.sleep(0.3)
    cs = get(f"{year}/constructorstandings/?limit=100")["StandingsTable"]["StandingsLists"]

    season_data = {
        "year": year,
        "round": done,
        "races": [{
            "round": int(r["round"]), "name": gp_ru(r["raceName"]), "nameEn": r["raceName"],
            "circuit": JOLPICA_TO_SVG.get(r["Circuit"]["circuitId"], r["Circuit"]["circuitId"]),
            "start": r["date"] + "T" + r.get("time", "12:00:00Z"),
            "winner": winners.get(r["round"]),
        } for r in races],
        "drivers": [{
            "code": d["Driver"]["code"], "first": d["Driver"]["givenName"],
            "last": d["Driver"]["familyName"], "number": d["Driver"].get("permanentNumber"),
            "team": d["Constructors"][-1]["constructorId"], "points": float(d["points"]),
            "wins": int(d["wins"]), "pos": int(d["position"]),
            "progression": [progression.get(d["Driver"]["code"], {}).get(r) for r in range(1, done + 1)],
        } for d in (ds[0]["DriverStandings"] if ds else [])],
        "teams": [{
            "id": t["Constructor"]["constructorId"], "name": t["Constructor"]["name"],
            "points": float(t["points"]), "wins": int(t["wins"]), "pos": int(t["position"]),
        } for t in (cs[0]["ConstructorStandings"] if cs else [])],
    }
    with open(os.path.join(ROOT, "data", "season.js"), "w", encoding="utf-8") as f:
        f.write("// Generated by tools/build_data.py from the Jolpica F1 API.\n")
        f.write("window.F1_SEASON = " + json.dumps(season_data, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"{len(circuits)} circuits, {sum(len(c['layouts']) for c in circuits)} layouts, "
          f"season {year} after round {done}")


if __name__ == "__main__":
    main()
