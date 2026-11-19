"""Pull candidate African/Caribbean markets & restaurants in the US from the latest Overture Maps
places release (public S3, no credentials) into a JSONL file of raw records.

Coarse filter here (DuckDB, pushed down to Parquet); precise classification happens in
scripts/overture/build.mjs so it shares the taxonomy and unit tests with the rest of the app.

Usage: python scripts/overture/extract.py OUT.jsonl [--source PATH_OR_GLOB] [--release YYYY-MM-DD.N]
"""
import argparse
import json
import pathlib
import re
import sys

import duckdb

ROOT = pathlib.Path(__file__).resolve().parents[2]
TAX = json.loads((ROOT / "shared" / "taxonomy.json").read_text())
enabled = {r["key"] for r in TAX["regions"] if r["enabled"]}
ORIGINS = [o for o in TAX["origins"] if o["region"] in enabled]
CUISINE_KEYS = sorted({o["key"] for o in ORIGINS} | {"west_african", "east_african"})
KEYWORDS = sorted({k for o in ORIGINS for k in o["keywords"]})

# Category tokens that mean "food business" for name-keyword matches
FOOD_HINT = r"restaurant|food|grocery|supermarket|convenience|market|deli|butcher|meat|seafood|bakery|eat_and_drink|cafe|caterer|catering|takeout|fast_food"

BUCKET = "s3://overturemaps-us-west-2/release"


def struct_fields(type_str: str) -> set[str]:
    """Top-level field names of a DuckDB STRUCT(...) type string (best effort)."""
    inner = type_str[type_str.find("(") + 1 : type_str.rfind(")")]
    depth, cur, names = 0, "", []
    for ch in inner:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            names.append(cur.strip())
            cur = ""
        else:
            cur += ch
    names.append(cur.strip())
    return {n.split(" ")[0].strip('"') for n in names if n}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--source", help="parquet path/glob (defaults to the latest Overture release on S3)")
    ap.add_argument("--release")
    ap.add_argument("--min-confidence", type=float, default=0.5)
    a = ap.parse_args()

    con = duckdb.connect()
    release = a.release
    src = a.source
    if not src:
        con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2'; SET s3_access_key_id=''; SET s3_secret_access_key='';")
        if not release:
            rels = con.execute(
                f"SELECT DISTINCT regexp_extract(file, 'release/([^/]+)/', 1) r FROM glob('{BUCKET}/*/theme=places/type=place/*') ORDER BY r"
            ).fetchall()
            release = [r[0] for r in rels if re.match(r"^\d{4}-\d{2}-\d{2}", r[0])][-1]
        src = f"{BUCKET}/{release}/theme=places/type=place/*"
    print(f"release={release} source={src}", flush=True)

    cols = {r[0]: r[1] for r in con.execute(f"DESCRIBE SELECT * FROM read_parquet('{src}') LIMIT 0").fetchall()}
    print("schema:", json.dumps(cols)[:3000], flush=True)

    # Category list expression across schema versions (taxonomy in v2, categories before)
    parts = []
    if "taxonomy" in cols:
        tf = struct_fields(cols["taxonomy"])
        if "primary" in tf:
            parts.append("[taxonomy.primary]")
        for f in ("alternates", "alternate", "hierarchy"):
            if f in tf:
                parts.append(f"coalesce(taxonomy.{f}, [])")
    if "categories" in cols:
        cf = struct_fields(cols["categories"])
        if "primary" in cf:
            parts.append("[categories.primary]")
        if "alternate" in cf:
            parts.append("coalesce(categories.alternate, [])")
    if "basic_category" in cols:
        parts.append("[basic_category]")
    if not parts:
        sys.exit("No category columns found in schema")
    cats = parts[0]
    for p in parts[1:]:
        cats = f"list_concat({cats}, {p})"
    cats = f"list_filter({cats}, lambda x: x IS NOT NULL)"

    cuisine_re = r"(^| )(" + "|".join(CUISINE_KEYS) + r")_restaurant( |$)"
    name_re = r"(?i)\b(" + "|".join(re.escape(k) for k in KEYWORDS) + r")\b"
    status_sel = ", operating_status" if "operating_status" in cols else ", NULL AS operating_status"

    sql = f"""
    COPY (
      WITH c AS (
        SELECT id, names.primary AS name, {cats} AS cats, confidence,
               websites, socials, phones, addresses[1] AS addr,
               (bbox.xmin + bbox.xmax) / 2 AS lng, (bbox.ymin + bbox.ymax) / 2 AS lat
               {status_sel}
        FROM read_parquet('{src}')
        WHERE bbox.xmin BETWEEN -179.5 AND -65 AND bbox.ymin BETWEEN 17 AND 72
          AND addresses[1].country = 'US'
          AND confidence >= {a.min_confidence}
      )
      SELECT * FROM c
      WHERE name IS NOT NULL
        AND ( regexp_matches(array_to_string(cats, ' '), '{cuisine_re}')
           OR ( regexp_matches(name, '{name_re}') AND regexp_matches(array_to_string(cats, ' '), '{FOOD_HINT}') ) )
    ) TO '{a.out}' (FORMAT JSON);
    """
    con.execute(sql)
    n = sum(1 for _ in open(a.out))
    print(f"wrote {n} candidate records to {a.out}", flush=True)
    pathlib.Path(a.out + ".release").write_text(release or "local")


if __name__ == "__main__":
    main()
