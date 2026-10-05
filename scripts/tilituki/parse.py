"""Tilituki Pro -aineisto JSON-tiedostoiksi Skogin tuontia varten.

    python scripts/tilituki/parse.py <kansio> [--ulos data/private/tilituki]

<kansio> on Tilitukin datakansio, jonka numeroidut alikansiot ovat asiakkaita
(1, 2, 3 ...), tai yksi asiakaskansio. Jokaisesta asiakkaasta kirjoitetaan
<ulos>/<kansio>.json:

  - client      perustiedot (YR.DBF): nimi, Y-tunnus, osoite, avoin verovuosi
  - accounts    tilikartta (KPTILIT.DBF): tilinumero, nimi, luokka, veronumero, alv-%
  - entries     viennit (KPVIHIST.DBF ja KPVIENTI.DBF) vuosittain
  - machinery   kalusto ja sen poistot vuosittain koko historialta (KALUSTO.DBF, KALUSPOI.DBF):
                kortin laji (Kone / Oja/Tie / Rakennus), ostopäivä, hankintahinta, ja vuosittain
                arvo alussa (PPEVLARVOA), lisäys (PPLISAYS), vähennys eli myynti (PPVAHENNYS),
                poistopohja (PPEVLMENOJ), poisto-% (PPEVLPROS), poisto (PPEVLPSUMM), arvo lopussa (PPEVLARVOL)
  - buildings   rakennukset ja niiden poistot vuosittain (RAKENNUS.DBF, RAKVUOSI.DBF)
  - form2       lomakkeen 2 luvut vuosittain uusimman lomakkeen tietuetunnuksilla (LOMAKE2_YYYY.DBF);
                vanhat lomakkeet käännetään veronumeron (VERONRO) kautta, koska tunnukset ovat vaihtuneet
  - form2c      lomakkeen 2C luvut samoin
  - form2Raw    lomakkeen 2 laskentarivit Tilitukin veronumeroittain (myös rivit ilman tietuetunnusta)
  - form2cRaw   lomakkeen 2C laskentarivit veronumeroittain (ilman hankintatyön tekijöitä)
  - templates   Tilitukin esimerkkiaineisto (sama vähintään kolmella asiakkaalla): vuodet, joiden
                viennit tai lomake ohitetaan

Henkilötunnusta ei kirjoiteta: Y-tunnus otetaan vain, jos se on Y-tunnuksen
muotoinen. Tulos sisältää silti nimiä ja vientien selitteitä, joten se
kirjoitetaan data/private-kansioon, joka ei ole versionhallinnassa. Skripti
tulostaa vain määriä.
"""

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dbf import read_dbf  # noqa: E402

Y_TUNNUS = re.compile(r"^\d{7}-\d$")
# Lomakkeen tietueet, jotka ovat tunnisteita tai otsikkotietoja eivätkä lukuja (TYVI-kehys).
FRAME_CODES = {"000", "001", "009", "010", "014", "041", "042", "044", "045", "048", "198", "999"}


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def find(folder, name):
    """Tiedosto kansiosta kirjainkoosta riippumatta (Tilitukissa nimet ovat sekaisin isoin ja pienin)."""
    want = name.lower()
    for f in os.listdir(folder):
        if f.lower() == want:
            return os.path.join(folder, f)
    return None


def table(folder, name, fields=None):
    p = find(folder, name)
    if not p:
        return []
    return read_dbf(p, fields)[1]


def num(s):
    """Lomakkeen tulostusarvo: '     14284,30' → 14284.3. Tyhjä tai teksti → None."""
    s = (s or "").strip().replace(" ", "").replace("\xa0", "").replace(",", ".")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def r2(x):
    return round(float(x or 0), 2)


def parse_client(folder):
    yr = {r["YRAVAIN"]: r for r in table(folder, "YR.DBF")}
    text = lambda key: ((yr.get(key) or {}).get("YRTIETOC") or "").strip()
    name = text("YRVIRALLINENNIMI") or text("XMLNIMI") or text("YRLASKUNIMI")
    # Verohallinnon muoto (sukunimi ensin), jolla nimi jaetaan suku- ja etunimeksi.
    tax_name = text("XMLNIMI")
    business_id = text("YRLYTUNN")
    if not Y_TUNNUS.match(business_id):
        business_id = ""
    street = text("YROSOITE")
    post = text("YRPOSTI")
    m = re.match(r"^(\d{5})\s+(.+)$", post)
    return {
        "name": name or None,
        "taxName": tax_name or None,
        "businessId": business_id or None,
        "street": street or None,
        "postalCode": m.group(1) if m else None,
        "city": m.group(2).strip() if m else None,
        "openYear": int(text("KPVEROVUOSI")) if text("KPVEROVUOSI").isdigit() else None,
        "vatMethod": text("ALVTAPA") or None,
    }


def parse_accounts(folder):
    out = []
    for r in table(folder, "KPTILIT.DBF"):
        if not r.get("KTTILI"):
            continue
        out.append({
            "number": r["KTTILI"],
            "name": r["KTTILINIMI"],
            "class": r["KTTILILUOK"],
            "taxCode": r["KTVERONRO"],
            "vatPct": r2(r.get("KTALVPROS")),
            "side": r["KTOLETUS"],
            "vatAccount": r["KTLISATILI"] or None,
        })
    return out


def parse_entries(folder):
    """Viennit vuosittain. Sama vienti voi olla sekä historiassa että avoimessa vuodessa; se otetaan kerran."""
    seen, out, dup = set(), {}, 0
    for name in ("KPVIHIST.DBF", "KPVIENTI.DBF"):
        for r in table(folder, name):
            # KVUNIIKKI on tositteen tunniste, joten rivin tunniste on tosite + rivinumero.
            key = f'{r["KVUNIIKKI"] or (r["KVTOSLAJI"] + str(r["KVTOSITE"]) + "-" + str(r["KVTOSPVM"]))}-{r["KVRIVINRO"]}'
            if key in seen:
                dup += 1
                continue
            seen.add(key)
            date = r["KVTOSPVM"]
            if not date:
                continue
            out.setdefault(date[:4], []).append({
                "id": key,
                "voucher": f'{r["KVTOSLAJI"]}{r["KVTOSITE"]}',
                "row": r["KVRIVINRO"],
                "date": date,
                "account": r["KVTILINRO"],
                "debit": r2(r["KVDEBET"]),
                "credit": r2(r["KVKREDIT"]),
                "gross": r2(r["KVPERSUMMA"]) if r["KVPERSUMMA"] is not None else None,
                "vatPct": r2(r["KVALVPROS"]),
                # Tilituki kirjaa veron omalle tililleen; KVMIINUS on rivin veron määrä.
                "vat": r2(r["KVMIINUS"]),
                "description": r["KVSELITE"] or "",
            })
    for rows in out.values():
        rows.sort(key=lambda e: (e["date"], e["voucher"], e["row"] or 0))
    return out, dup


def parse_machinery(folder):
    years = {}
    for p in table(folder, "KALUSPOI.DBF"):
        # Vuodeton rivi on Tilitukin keskeneräinen tietue ilman lukuja.
        if not (p["PPVUOSI"] or "").strip().isdigit():
            continue
        years.setdefault(p["PKUNIIKKI"], {})[p["PPVUOSI"].strip()] = {
            "pct": r2(p["PPEVLPROS"]),
            "start": r2(p["PPEVLARVOA"]),
            "additions": r2(p["PPLISAYS"]),
            "disposals": r2(p["PPVAHENNYS"]),
            "base": r2(p["PPEVLMENOJ"]),
            "depreciation": r2(p["PPEVLPSUMM"]),
            "end": r2(p["PPEVLARVOL"]),
        }
    out = []
    for k in table(folder, "KALUSTO.DBF"):
        out.append({
            "id": k["PKUNIIKKI"],
            "name": k["PKNIMI"],
            "type": k["PKTYYPPI"],
            "source": k["PKTULOLAHD"],
            "acquiredOn": k["PKOSTOPVM"],
            "usedFrom": k["PKKAYTTOPV"],
            "cost": r2(k["PKHHINTA"]),
            "maxPct": r2(k["PKMAXPPROS"]),
            "years": years.get(k["PKUNIIKKI"], {}),
        })
    return out


def parse_buildings(folder):
    years = {}
    for v in table(folder, "RAKVUOSI.DBF"):
        if not (v["TRVVUOSI"] or "").strip().isdigit():
            continue
        years.setdefault(v["TRVRNRO"], {})[v["TRVVUOSI"].strip()] = {
            "start": r2(v["TRVPTAMALK"]),
            "additions": r2(v["TRVMENOT"]) + r2(v["TRVMUUMENO"]),
            "sales": r2(v["TRVLUOVHIN"]),
            "compensation": r2(v["TRVKORVAUS"]),
            "grants": r2(v["TRVAVUSTUS"]),
            "equalization": r2(v["TRVTASVARA"]),
            "replacementReserve": r2(v["TRVJHVARA"]),
            "transfers": r2(v["TRVSIIRTOT"]),
            "base": r2(v["TRVMENOJ"]),
            "pct": r2(v["TRVPOISTOP"]),
            "depreciation": r2(v["TRVPOISTMK"]),
            "end": r2(v["TRVPTAMLOP"]),
        }
    out = []
    for b in table(folder, "RAKENNUS.DBF"):
        out.append({
            "id": b["TR_UNIIKKI"],
            "number": b["TR_RNRO"],
            "name": b["TR_NIMI"],
            "type": b["TR_RTYYPPI"],
            # Poistoluokka: 1 = tuotantorakennus 10 %, 2 = asuinrakennus 6 %, 3 = kasvihuone ym. 20 %, 4 = ympäristönsuojelu 25 %.
            "depreciationClass": b["TR_POISTOL"],
            "acquiredYear": b["TR_HANKV"] or None,
            "cost": r2(b["TR_HANKHIN"]),
            "maxPct": r2(b["TR_MAXPROS"]),
            "years": years.get(b["TR_RNRO"], {}),
        })
    return out



# Hankintatyön tekijät (2C, tunnukset 700–706) jätetään pois: ne ovat henkilökohtaisia.
WORKER_CODES = {str(c) for c in range(700, 707)}
# Vanhat veronumerot, joiden merkitys on sama kuin uusimman lomakkeen numerolla (tarkistettu nimistä
# vuosilta 2004–2025). Koneiden ryhmä jaettiin 2019 _YHT-numeroihin korotetun poiston vuoksi, ja
# velkojen ja metsän vuosimenojen lomakkeen luku sai _L-päätteen. Tulot yhteensä oli ennen vuotta
# 2017 L2_222 (nyt L2_263 = 332). Muita päätteettömiä nimiä ei käännetä: esimerkiksi L2_160 oli
# ennen yrittäjäpuolison tappio, L2_160_YHT on pääomatuloista vähennettävä tappio (420).
EXTRA_ALIASES = {"L2_222": "332"}
ALIAS_BASES = {
    "_YHT": ["L21_110", "L21_111", "L21_112", "L21_113", "L21_1132", "L21_117", "L21_118"],
    "_L": ["L2_410", "L2C_118", "L2C_119"],
}


def form_rows(folder):
    """Lomakkeiden rivit vuosittain: (tietuetunnus, veronumero, arvo). Vain numerokentät; tekstikentissä on nimiä ja tunnuksia."""
    out = {}
    for f in os.listdir(folder):
        m = re.fullmatch(r"lomake2_(\d{4})\.dbf", f.lower())
        if not m:
            continue
        rows = read_dbf(os.path.join(folder, f), ["TYVINRO", "VERONRO", "TYYPPI", "TULOSTA"])[1]
        out[m.group(1)] = [
            ((r.get("TYVINRO") or "").strip(), (r["VERONRO"] or "").strip(), num(r["TULOSTA"]))
            for r in rows
            if r["TYYPPI"] == "N" and (r["VERONRO"] or "").startswith(("L2_", "L21_", "L2C_"))
        ]
    return out


def canonical_codes(all_rows):
    """
    Veronumero → uusimman lomakkeen tietuetunnus. Tilitukin veronumero (VERONRO) on pysyvä nimi
    lomakkeen kohdalle, mutta Verohallinnon tietuetunnus (TYVINRO) on vaihtunut vuosien mittaan
    (esim. tasausvaraukset 290–295 → 170–175 vuonna 2017), eikä sitä ole lainkaan ennen vuotta 2004.
    Vanhat lomakkeet käännetään uusimman vuoden tunnuksille veronumeron kautta, jotta tuonti ja
    vertailu käyttävät samoja tunnuksia kaikille vuosille.
    """
    latest = max((y for rows in all_rows for y in rows), default=None)
    votes, workers = {}, set()
    for rows in all_rows:
        for code, veronro, _ in rows.get(latest, []):
            if not re.fullmatch(r"\d{3}", code) or code in FRAME_CODES:
                continue
            if veronro.startswith("L2C_") and code in WORKER_CODES:
                workers.add(veronro)
                continue
            votes.setdefault(veronro, {}).setdefault(code, 0)
            votes[veronro][code] += 1
    canon = {v: max(c.items(), key=lambda x: x[1])[0] for v, c in votes.items()}
    aliases = dict(EXTRA_ALIASES)
    for suffix, bases in ALIAS_BASES.items():
        for base in bases:
            if base + suffix in canon and base not in canon:
                aliases[base] = canon[base + suffix]
    return latest, canon, aliases, workers


def normalize_form(rows, canon, aliases, workers):
    """Vuoden lomake uusimman lomakkeen tunnuksilla. Ensisijainen veronumero voittaa vanhan nimen."""
    f2, f2c, raw, rawc = {}, {}, {}, {}
    values = {}
    for _, veronro, value in rows:
        if value:
            values.setdefault(veronro, value)
    for veronro, value in values.items():
        if veronro.startswith("L2C_"):
            if veronro not in workers:
                rawc[veronro] = value
        else:
            raw[veronro] = value
    for table in (canon, aliases):
        for veronro, value in values.items():
            code = table.get(veronro)
            if not code:
                continue
            target = f2c if veronro.startswith("L2C_") else f2
            if table is aliases and code in target:
                continue
            target.setdefault(code, value)
    # Kohta, jota uusimmalla lomakkeella ei ole (esim. 233, rehut 10 %, poistui 2025), säilyy omalla
    # tunnuksellaan, jos tunnus ei ole uusimmalla lomakkeella muussa käytössä.
    used = set(canon.values()) | set(aliases.values())
    for code, veronro, value in rows:
        if not value or veronro in canon or veronro in aliases or veronro in workers:
            continue
        if re.fullmatch(r"\d{3}", code) and code not in FRAME_CODES and code not in used:
            (f2c if veronro.startswith("L2C_") else f2).setdefault(code, value)
    return f2, f2c, raw, rawc


def entry_signature(rows):
    return json.dumps(sorted((e["date"], e["account"], e["debit"], e["credit"]) for e in rows))


# Pelkät omistus- ja jako-osuudet (100 / 0) ovat samat monella asiakkaalla, joten ne eivät tee lomakkeesta esimerkkiä.
SHARE_ONLY = {"L2_415", "L2_416", "L2_417", "L2_418", "L2_427_NRO", "L2C_133", "L2C_134"}


def form_signature(d, y):
    raw, rawc = d["form2Raw"].get(y, {}), d["form2cRaw"].get(y, {})
    if not (set(raw) | set(rawc)) - SHARE_ONLY:
        return None
    return json.dumps([raw, rawc], sort_keys=True)


def find_templates(datas):
    """
    Tilitukin esimerkkiaineisto: vuoden viennit tai lomake, joka on täsmälleen sama vähintään
    kolmella asiakkaalla, ei ole asiakkaan omaa kirjanpitoa (Tilituki on kopioinut vuoden 2001
    viennit ja vuoden 2002 lomakkeen uusille asiakkaille). Ne merkitään, ja tuonti ohittaa ne.
    """
    counts = {}
    for d in datas:
        for y, rows in d["entries"].items():
            k = ("e", y, entry_signature(rows))
            counts[k] = counts.get(k, 0) + 1
        for y in d["form2Raw"]:
            sig = form_signature(d, y)
            if sig:
                counts[("f", y, sig)] = counts.get(("f", y, sig), 0) + 1
    for d in datas:
        ent = [y for y, rows in d["entries"].items() if counts[("e", y, entry_signature(rows))] >= 3]
        frm = [y for y in d["form2Raw"] if form_signature(d, y) and counts[("f", y, form_signature(d, y))] >= 3]
        d["templates"] = {"entries": sorted(ent), "forms": sorted(frm)}
        # Esimerkkilomakkeen luvut eivät ole asiakkaan: lomake tyhjäksi, jotta tuonti ei käytä niitä.
        for y in frm:
            d["form2"][y], d["form2c"][y], d["form2Raw"][y], d["form2cRaw"][y] = {}, {}, {}, {}


def parse_folder(folder, rows, canon, aliases, workers):
    entries, dup = parse_entries(folder)
    form2, form2c, raw, rawc = {}, {}, {}, {}
    for y, r in rows.items():
        form2[y], form2c[y], raw[y], rawc[y] = normalize_form(r, canon, aliases, workers)
    return {
        "folder": os.path.basename(os.path.normpath(folder)),
        "client": parse_client(folder),
        "accounts": parse_accounts(folder),
        "entries": entries,
        "machinery": parse_machinery(folder),
        "buildings": parse_buildings(folder),
        "form2": form2,
        "form2c": form2c,
        "form2Raw": raw,
        "form2cRaw": rawc,
    }, dup


def client_folders(root):
    if find(root, "KPTILIT.DBF"):
        return [root]
    subs = [d for d in os.listdir(root) if d.isdigit() and os.path.isdir(os.path.join(root, d))]
    return [os.path.join(root, d) for d in sorted(subs, key=int)]


def main():
    if len(sys.argv) < 2 or sys.argv[1].startswith("--"):
        sys.exit("Käyttö: python scripts/tilituki/parse.py <kansio> [--ulos data/private/tilituki]")
    root = sys.argv[1]
    out_dir = arg("--ulos", os.path.join("data", "private", "tilituki"))
    os.makedirs(out_dir, exist_ok=True)
    skipped = 0
    folders = []
    for folder in client_folders(root):
        if not find(folder, "KPTILIT.DBF"):
            skipped += 1
            print(f"kansio {os.path.basename(folder)}: ei kirjanpitoa, ohitettu")
            continue
        folders.append(folder)
    # Kaksi kierrosta: ensin kaikkien asiakkaiden lomakkeista tunnusten kartta, sitten asiakkaat.
    rows = {f: form_rows(f) for f in folders}
    latest, canon, aliases, workers = canonical_codes(list(rows.values()))
    datas = [parse_folder(f, rows[f], canon, aliases, workers) for f in folders]
    find_templates([d for d, _ in datas])
    for data, dup in datas:
        with open(os.path.join(out_dir, f'{data["folder"]}.json'), "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1)
        years = sorted(data["entries"])
        forms = sorted(y for y, v in data["form2"].items() if v or data["form2c"].get(y))
        t = data["templates"]
        print(
            f'kansio {data["folder"]}: tilejä {len(data["accounts"])}, vientejä {sum(len(v) for v in data["entries"].values())} '
            f"(vuodet {years[0] if years else '-'}–{years[-1] if years else '-'}), kalustoa {len(data['machinery'])}, "
            f"rakennuksia {len(data['buildings'])}, lomakkeita {len(forms)} ({forms[0] if forms else '-'}–{forms[-1] if forms else '-'}), "
            f"Y-tunnus {'on' if data['client']['businessId'] else 'ei'}"
            + (f", esimerkkiaineistoa: viennit {','.join(t['entries'])}" if t["entries"] else "")
            + (f", esimerkkilomakkeet {','.join(t['forms'])}" if t["forms"] else "")
            + (f", kaksoisvientejä ohitettu {dup}" if dup else "")
        )
    print(f"Lomakkeiden tunnukset vuoden {latest} mukaan: {len(canon)} veronumeroa, {len(aliases)} vanhaa nimeä.")
    print(f"Valmis: {len(datas)} asiakasta, {skipped} kansiota ohitettu. Tulos: {out_dir}")


if __name__ == "__main__":
    main()
