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
  - form2       lomakkeen 2 luvut tietuetunnuksittain vuosittain (LOMAKE2_YYYY.DBF)
  - form2c      lomakkeen 2C luvut samasta taulusta
  - form2Raw    lomakkeen 2 laskentarivit Tilitukin veronumeroittain (myös rivit ilman tietuetunnusta)

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


def parse_forms(folder):
    """Lomakkeiden 2 ja 2C luvut vuosittain. Vain numerokentät; tekstikentissä on nimiä ja tunnuksia."""
    form2, form2c, raw = {}, {}, {}
    for f in os.listdir(folder):
        m = re.fullmatch(r"lomake2_(\d{4})\.dbf", f.lower())
        if not m:
            continue
        year = m.group(1)
        rows = read_dbf(os.path.join(folder, f), ["TYVINRO", "VERONRO", "TYYPPI", "TULOSTA"])[1]
        f2, f2c, rw = {}, {}, {}
        for r in rows:
            if r["TYYPPI"] != "N":
                continue
            code, veronro, value = (r.get("TYVINRO") or "").strip(), r["VERONRO"] or "", num(r["TULOSTA"])
            if not value:
                continue
            if veronro.startswith(("L2_", "L21_")):
                rw[veronro] = value
                if re.fullmatch(r"\d{3}", code) and code not in FRAME_CODES:
                    f2.setdefault(code, value)
            elif veronro.startswith("L2C_") and re.fullmatch(r"\d{3}", code) and code not in FRAME_CODES and not ("700" <= code <= "706"):
                # Hankintatyön tekijät (700–706) jätetään pois: ne ovat henkilökohtaisia.
                f2c.setdefault(code, value)
        form2[year], form2c[year], raw[year] = f2, f2c, rw
    return form2, form2c, raw


def parse_folder(folder):
    entries, dup = parse_entries(folder)
    form2, form2c, raw = parse_forms(folder)
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
    written = skipped = 0
    for folder in client_folders(root):
        if not find(folder, "KPTILIT.DBF"):
            skipped += 1
            print(f"kansio {os.path.basename(folder)}: ei kirjanpitoa, ohitettu")
            continue
        data, dup = parse_folder(folder)
        with open(os.path.join(out_dir, f'{data["folder"]}.json'), "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1)
        written += 1
        years = ", ".join(f"{y}: {len(v)}" for y, v in sorted(data["entries"].items()) if y >= "2023") or "-"
        forms = ", ".join(f"{y}: {len(v)}" for y, v in sorted(data["form2"].items()) if y >= "2023") or "-"
        print(
            f'kansio {data["folder"]}: tilejä {len(data["accounts"])}, vientejä {sum(len(v) for v in data["entries"].values())} '
            f"(vuodet {years}), kalustoa {len(data['machinery'])}, rakennuksia {len(data['buildings'])}, "
            f"lomake 2 kenttiä ({forms}), Y-tunnus {'on' if data['client']['businessId'] else 'ei'}"
            + (f", kaksoisvientejä ohitettu {dup}" if dup else "")
        )
    print(f"Valmis: {written} asiakasta, {skipped} kansiota ohitettu. Tulos: {out_dir}")


if __name__ == "__main__":
    main()
