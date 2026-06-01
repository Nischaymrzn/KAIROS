"""Per-source cleaning for the shot spine. Keeps every shot type (incl. dunks)."""
from __future__ import annotations
import pandas as pd

NUMERIC = ["LOC_X", "LOC_Y", "SHOT_DISTANCE", "QUARTER", "MINS_LEFT", "SECS_LEFT"]
STRINGS = ["POSITION_GROUP", "POSITION", "ACTION_TYPE", "SHOT_TYPE",
           "BASIC_ZONE", "ZONE_NAME", "ZONE_RANGE", "EVENT_TYPE"]


def clean_shots(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    for c in NUMERIC:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    for c in STRINGS:
        df[c] = df[c].astype("string").str.strip()

    # target: binary make flag from the unambiguous event type
    df["MADE"] = (df["EVENT_TYPE"] == "Made Shot").astype("int8")

    # drop fully duplicated shot rows (NBA_Shots has no event id)
    before = len(df)
    df = df.drop_duplicates(subset=[c for c in df.columns if c != "SHOT_ID"])
    dropped = before - len(df)
    if dropped:
        print(f"  dropped {dropped:,} duplicate shot rows")

    # basic validity
    df = df[df["SHOT_DISTANCE"].notna() & (df["SHOT_DISTANCE"] >= 0)]
    df = df[df["QUARTER"].between(1, 10)]
    df = df[df["MINS_LEFT"].notna() & df["SECS_LEFT"].notna()]

    # downcast to keep ~1M rows light
    df["SHOT_DISTANCE"] = df["SHOT_DISTANCE"].astype("float32")
    df["LOC_X"] = df["LOC_X"].astype("float32")
    df["LOC_Y"] = df["LOC_Y"].astype("float32")
    for c in ["QUARTER", "MINS_LEFT", "SECS_LEFT"]:
        df[c] = df[c].astype("int16")
    df["PLAYER_ID"] = df["PLAYER_ID"].astype("int64")

    df = df.reset_index(drop=True)
    assert df["MADE"].isin([0, 1]).all() and df["MADE"].notna().all()
    return df
