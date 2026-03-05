const axios = require("axios");
const { sql, getPool } = require("../db/sql");

function toDateOrNull(x) {
  if (!x) return null;
  const d = new Date(x);
  return Number.isNaN(d.getTime()) ? null : d;
}


function makeRawKey({ imo, vesselUid, mmsi }) {
  if (imo) return String(imo);
  if (vesselUid != null) return `UID:${vesselUid}`; 
  if (mmsi != null) return `MMSI:${mmsi}`; 
  return `UNK:${Date.now()}`; 
}

async function fetchAisLatest({ limit = 100 } = {}) {
  const base = (process.env.KPLER_BASE_URL || "").trim();
  const token = (process.env.KPLER_TOKEN || "").trim().replace(/^"|"$/g, "");
  const url = `${base}/v2/maritime/ais-latest`;

  const res = await axios.get(url, {
    params: { format: "json", limit },
    headers: {
      Authorization: `Basic ${token}`,
      Accept: "application/json",
    },
    timeout: 30000,
  });

  return res.data;
}


async function syncAisLatestToDb({ limit = 100 } = {}) {
  const payload = await fetchAisLatest({ limit });

  if (!payload || !Array.isArray(payload.features)) {
    return { ok: false, insertedRaw: 0, insertedPositions: 0, skippedDuplicates: 0 };
  }

  const pool = await getPool();
  let insertedRaw = 0;
  let insertedPositions = 0;
  let skippedDuplicates = 0;

  const insertSql = `
INSERT INTO dbo.AIS_VesselPosition (
  FeatureType, GeometryName, GeometryType,
  Longitude, Latitude, CallSign, COG, Destination,
  Draught, DWT, ETA, Flag, GRT, Heading, IMO,
  InsertDt, Length, MMSI, NavStatus, PosDt,
  PosMsgType, PosSrc, ROT, SOG,
  StaticDt, StaticMsgType, StaticSrc,
  VesselName, VesselType, VesselTypeAIS,
  VesselUID, Width, RawJson
)
VALUES (
  @FeatureType, @GeometryName, @GeometryType,
  @Longitude, @Latitude, @CallSign, @COG, @Destination,
  @Draught, @DWT, @ETA, @Flag, @GRT, @Heading, @IMO,
  @InsertDt, @Length, @MMSI, @NavStatus, @PosDt,
  @PosMsgType, @PosSrc, @ROT, @SOG,
  @StaticDt, @StaticMsgType, @StaticSrc,
  @VesselName, @VesselType, @VesselTypeAIS,
  @VesselUID, @Width, @RawJson
);
`;

  for (const feature of payload.features) {
    const props = feature?.properties || {};
    const geometry = feature?.geometry || {};

    const vesselUid = props.vesselUid ?? null;
    if (!vesselUid) continue;

    const posDt = toDateOrNull(props.posDt);
    if (!posDt) continue; 

    const rawKey = makeRawKey({
      imo: props.imo,
      vesselUid,
      mmsi: props.mmsi,
    });

    const rawJson = JSON.stringify(feature);

    // ================= RAW =================
    const rawReq = pool.request();
    rawReq.input("IMO", sql.VarChar(20), rawKey);
    rawReq.input("Data", sql.NVarChar(sql.MAX), rawJson);
    rawReq.input("VesselUid", sql.BigInt, vesselUid);

    await rawReq.query(`
MERGE dbo.AIS_VesselsRAW AS T
USING (SELECT @IMO AS IMO, @Data AS Data, @VesselUid AS VesselUid) AS S
ON T.IMO = S.IMO
WHEN MATCHED THEN
  UPDATE SET
    T.Data = S.Data,
    T.VesselUid = S.VesselUid,
    T.UpdatedAt = GETDATE()
WHEN NOT MATCHED THEN
  INSERT (IMO, Data, VesselUid, CreatedAt, UpdatedAt)
  VALUES (S.IMO, S.Data, S.VesselUid, GETDATE(), GETDATE());
    `);

    insertedRaw++;

    // ================= POSITION =================
    const posReq = pool.request();

    posReq.input("FeatureType", sql.VarChar(100), feature.type);
    posReq.input("GeometryName", sql.VarChar(200), feature.geometry_name);
    posReq.input("GeometryType", sql.VarChar(50), geometry.type);

    posReq.input("Longitude", sql.Decimal(10, 7), props.longitude);
    posReq.input("Latitude", sql.Decimal(10, 7), props.latitude);

    posReq.input("CallSign", sql.VarChar(100), props.callsign);
    posReq.input("COG", sql.Int, props.cog);
    posReq.input("Destination", sql.VarChar(500), props.destination);
    posReq.input("Draught", sql.Decimal(10, 2), props.draught);
    posReq.input("DWT", sql.BigInt, props.dwt);
    posReq.input("ETA", sql.DateTime2, toDateOrNull(props.eta));
    posReq.input("Flag", sql.VarChar(100), props.flag);
    posReq.input("GRT", sql.BigInt, props.grt);
    posReq.input("Heading", sql.Int, props.heading);
    posReq.input("IMO", sql.BigInt, props.imo);
    posReq.input("InsertDt", sql.DateTime2, toDateOrNull(props.insertDt));
    posReq.input("Length", sql.Decimal(10, 2), props.length);
    posReq.input("MMSI", sql.BigInt, props.mmsi);
    posReq.input("NavStatus", sql.Int, props.navStatus);
    posReq.input("PosDt", sql.DateTime2, posDt);
    posReq.input("PosMsgType", sql.Int, props.posMsgType);
    posReq.input("PosSrc", sql.VarChar(50), props.posSrc);
    posReq.input("ROT", sql.Decimal(10, 2), props.rot);
    posReq.input("SOG", sql.Decimal(10, 2), props.sog);
    posReq.input("StaticDt", sql.DateTime2, toDateOrNull(props.staticDt));
    posReq.input("StaticMsgType", sql.Int, props.staticMsgType);
    posReq.input("StaticSrc", sql.VarChar(50), props.staticSrc);
    posReq.input("VesselName", sql.VarChar(300), props.vesselName);
    posReq.input("VesselType", sql.VarChar(200), props.vesselType);
    posReq.input("VesselTypeAIS", sql.Int, props.vesselTypeAis);
    posReq.input("VesselUID", sql.BigInt, vesselUid);
    posReq.input("Width", sql.Decimal(10, 2), props.width);
    posReq.input("RawJson", sql.NVarChar(sql.MAX), rawJson);

    try {
      await posReq.query(insertSql);
      insertedPositions++;
    } catch (e) {
      // 2601 = duplicate key, 2627 = unique constraint violation
      if (e?.number === 2601 || e?.number === 2627) {
        skippedDuplicates++;
      } else {
        throw e;
      }
    }
  }

  return {
    ok: true,
    insertedRaw,
    insertedPositions,
    skippedDuplicates,
    data: payload,
  };
}
module.exports = { syncAisLatestToDb };