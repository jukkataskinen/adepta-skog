"""Visual FoxPron DBF-taulujen lukija ilman ulkoisia riippuvuuksia.

Tilituki Pro tallentaa tiedot DBF-tiedostoihin (FoxPro 2 / Visual FoxPro). Luemme
vain tarvittavat tyypit. Muistiokenttiä (FPT) ei lueta, koska tuonti ei tarvitse niitä:
selitteet ovat C-kentissä ja ne jätetään joka tapauksessa tuonnin ulkopuolelle.
"""

import datetime
import struct

# Otsikon tavu 29 kertoo koodisivun. Tilitukin tiedostoissa se on 0x03 (Windows ANSI),
# mutta varaudumme myös DOS-koodisivuun, jos vanhoja tauluja on mukana.
CODEPAGES = {0x01: "cp437", 0x02: "cp850", 0x03: "cp1252", 0x64: "cp852", 0x7D: "cp1255", 0xC8: "cp1250", 0xC9: "cp1251", 0xCA: "cp1254", 0xCB: "cp1253", 0x57: "cp1252"}


class Field:
    __slots__ = ("name", "type", "offset", "length", "decimals")

    def __init__(self, name, ftype, offset, length, decimals):
        self.name, self.type, self.offset, self.length, self.decimals = name, ftype, offset, length, decimals


def read_header(data):
    if len(data) < 32:
        raise ValueError("liian lyhyt DBF")
    count = struct.unpack_from("<I", data, 4)[0]
    header_len, record_len = struct.unpack_from("<HH", data, 8)
    codepage = CODEPAGES.get(data[29], "cp1252")
    fields, pos, offset = [], 32, 1
    while pos + 32 <= header_len and data[pos] != 0x0D:
        raw = data[pos : pos + 32]
        name = raw[:11].split(b"\x00")[0].decode("cp1252", "replace").upper()
        ftype = chr(raw[11])
        length, decimals = raw[16], raw[17]
        # FoxPro tallentaa kentän sijainnin itse; luotetaan juoksevaan laskuriin,
        # koska dBase III -tiedostoissa kenttä on nolla.
        fields.append(Field(name, ftype, offset, length, decimals))
        offset += length
        pos += 32
    return count, header_len, record_len, codepage, fields


def _value(field, raw, codepage):
    t = field.type
    if t in ("C", "V"):
        return raw.decode(codepage, "replace").rstrip(" \x00")
    if t in ("N", "F"):
        s = raw.decode("ascii", "replace").strip().replace(",", ".")
        if not s or s.strip("*") == "":
            return None
        try:
            return float(s) if (field.decimals or "." in s) else int(s)
        except ValueError:
            return None
    if t == "D":
        s = raw.decode("ascii", "replace").strip()
        if len(s) != 8 or not s.isdigit() or s == "00000000":
            return None
        try:
            return datetime.date(int(s[:4]), int(s[4:6]), int(s[6:])).isoformat()
        except ValueError:
            return None
    if t == "L":
        c = raw[:1].upper()
        return True if c in (b"T", b"Y") else False if c in (b"F", b"N") else None
    if t == "I":
        return struct.unpack("<i", raw[:4])[0]
    if t == "Y":
        # Valuutta: kokonaisluku kymmenestuhannesosina.
        return struct.unpack("<q", raw[:8])[0] / 10000
    if t == "B":
        return struct.unpack("<d", raw[:8])[0]
    if t == "T":
        day, ms = struct.unpack("<ii", raw[:8])
        if day == 0:
            return None
        # Juliaaninen päivänumero → päivämäärä.
        d = datetime.date.fromordinal(day - 1721425)
        return d.isoformat()
    # Muistio-, yleis- ja nollalippukenttiä ei tarvita.
    return None


def read_dbf(path, fields=None, include_deleted=False):
    """Palauttaa (kenttänimet, rivit) – rivit sanakirjoina. Poistetut rivit ('*') ohitetaan."""
    with open(path, "rb") as f:
        data = f.read()
    count, header_len, record_len, codepage, all_fields = read_header(data)
    wanted = [f for f in all_fields if f.type != "0" and (fields is None or f.name in fields)]
    rows = []
    for i in range(count):
        start = header_len + i * record_len
        rec = data[start : start + record_len]
        if len(rec) < record_len:
            break
        if rec[:1] == b"*" and not include_deleted:
            continue
        rows.append({f.name: _value(f, rec[f.offset : f.offset + f.length], codepage) for f in wanted})
    return [f.name for f in all_fields], rows


def describe(path):
    """Taulun rakenne ilman sisältöä: (rivimäärä, koodisivu, [(nimi, tyyppi, pituus, desimaalit)])."""
    with open(path, "rb") as f:
        data = f.read(65536)
    count, _, _, codepage, fields = read_header(data)
    return count, codepage, [(f.name, f.type, f.length, f.decimals) for f in fields]
