// ===================================================================
// Milesight gateway built-in NS codec - MacSync_LBS_STD_X1 RS485 / ANALOG node
// Milesight (UG63/UG65/UG67) embedded NS is ChirpStack v3 based:
//   decoder box entry point : Decode(fPort, bytes)   (wrapper at end of file)
//   encoder box entry point : Encode(fPort, obj)     (wrapper at end of file)
// Paste this WHOLE file into BOTH the decoder and encoder boxes.
// UPLINK ports: 0x02 heartbeat (RS485 or analog), 0x03 sampling,
//               0x04 trigger, 0x05 boot, 0x10-0x15 config-ACK,
//               8/9/10/12/13/15 RS485/Modbus downlink replies
// DOWNLINK ports (encodeDownlink):
//   Modbus : 8 coil-write, 9 reg-write, 10 field-config, 12 baud,
//            13 reg-read, 15 field-read
//   Config : 16 tx-interval, 17 adr, 18 msgtype, 19 msginfo,
//            20 trigger, 21 sampling
// Output shape:
//   type       : heartbeat | sampling | trigger | boot | config_ack | modbus_ack
//   deviceInfo : { fPort, source, battery, unixUTC, timeUTC, timeIST, ... }
//   sensorInfo : readings ; modbusAck : downlink-reply details
// ===================================================================

var IST_OFFSET = 19800;   // +5:30 in seconds

// ---- byte helpers ----------------------------------------------
function u16(b, i) { return (b[i] << 8) | b[i + 1]; }
function i16(b, i) { var v = u16(b, i); return (v & 0x8000) ? v - 0x10000 : v; }
function u32(b, i) { return ((b[i] << 24) >>> 0) + (b[i+1] << 16) + (b[i+2] << 8) + b[i+3]; }
function pad(n) { return ("0" + n).slice(-2); }
function fx2(v) { return v.toFixed(2); }                 // 5 -> "5.00"
function chAB(n) { return (n === 1) ? "A" : (n === 2) ? "B" : ("" + n); }
function stateText(s) { return (s === 0) ? "ok" : (s === 2) ? "invalid" : "failed"; }

// IEEE-754 float32 by hand (works on every ChirpStack JS runtime)
function f32(u) {
  var sign = (u >>> 31) ? -1 : 1;
  var exp  = (u >>> 23) & 0xFF;
  var man  = u & 0x7FFFFF;
  if (exp === 0)   { return sign * man * Math.pow(2, -149); }
  if (exp === 255) { return man ? NaN : sign * Infinity; }
  return sign * (man + 0x800000) * Math.pow(2, exp - 150);
}

// ISO string with explicit offset; "not synced" when time is 0.
function isoString(unixSec, offsetSec) {
  if (!unixSec) { return "not synced"; }
  var d = new Date((unixSec + offsetSec) * 1000);
  var s = d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" +
          pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + ":" +
          pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds());
  return offsetSec === 0 ? s + "Z" : s + "+05:30";
}

// Common deviceInfo block. source may be null (trigger/boot/modbus carry no flag).
function buildDeviceInfo(fPort, source, battery, unixUTC) {
  var di = { fPort: fPort };
  if (source !== null && source !== undefined) { di.source = source; }
  di.battery = battery;
  di.unixUTC = unixUTC;
  di.timeUTC = isoString(unixUTC, 0);
  di.timeIST = isoString(unixUTC, IST_OFFSET);
  return di;
}

var TYPE_NAME = ["int16", "uint16", "int32", "int32_swapped",
                 "float32", "float32_swapped", "uint32_swapped", "uint32"];
// analog mode: 1 = 4-20mA, 2 = 0-10V, 3 = digital
var ANALOG_MODE = ["off", "4-20mA", "0-10V", "digital"];

function decodeValue(type, b, i) {
  switch (type) {
    case 0: return i16(b, i);
    case 1: return u16(b, i);
    case 2: return (u32(b, i) | 0);
    case 3: return ((((b[i+2]<<24)>>>0) + (b[i+3]<<16) + (b[i]<<8) + b[i+1]) | 0);
    case 4: return f32(u32(b, i));
    case 5: return f32(((b[i+2]<<24)>>>0) + (b[i+3]<<16) + (b[i]<<8) + b[i+1]);
    case 6: return (((b[i+2]<<24)>>>0) + (b[i+3]<<16) + (b[i]<<8) + b[i+1]) >>> 0;
    case 7: return u32(b, i);
  }
  return null;
}

// Analog heartbeat: returns {channels, battery, unixUTC}. Starts at byte 2.
function decodeAnalogChannels(b) {
  var i = 2, chans = [];
  for (var ch = 1; ch <= 2; ch++) {
    if (i >= b.length) { break; }
    var chLabel = chAB(ch);
    var t = b[i++];
    if (t === 0) {
      chans.push({ channel: chLabel, sensor_type: "off", status: "not_configured" });
      continue;
    }
    if (t > 3 || i + 2 > b.length) {
      chans.push({ channel: chLabel, sensor_type: "invalid", status: "bad_type", type_raw: t });
      continue;
    }
    var val = u16(b, i) / 1000; i += 2;          // firmware sends value x1000
    var o = { channel: chLabel, sensor_type: ANALOG_MODE[t], status: "ok" };
    if (t === 1) {                                // 4-20 mA
      o.current_mA = fx2(val);
      if (val < 3.5)  { o.fault = "under_range"; }
      if (val > 20.5) { o.fault = "over_range";  }
    } else if (t === 2) {                         // 0-10 V
      o.voltage_V = fx2(val);
    } else if (t === 3) {                         // digital 0/1
      o.digital = (val >= 0.5) ? 1 : 0;
      o.state   = (val >= 0.5) ? "HIGH" : "LOW";
    }
    chans.push(o);
  }
  var battery = (i < b.length) ? b[i++] : null;
  var unixUTC = (i + 4 <= b.length) ? u32(b, i) : 0;
  return { channels: chans, battery: battery, unixUTC: unixUTC };
}

// Modbus downlink-reply deviceInfo: UTC is the last 4 bytes, no battery.
function modbusDeviceInfo(fPort, b) {
  var utc = u32(b, b.length - 4);
  var di = buildDeviceInfo(fPort, null, null, utc);
  delete di.battery;
  return di;
}

// ===================================================================
// UPLINK DECODER
// ===================================================================
function decodeUplink(input) {
  var b = input.bytes;
  var fPort = input.fPort;
  var data = {};

  // ---------- Port 0x02 : heartbeat (RS485 or analog) ----------
  if (fPort === 0x02) {
    if (b.length < 7) { return { data: { type: "error", error: "short payload" } }; }

    if (b[1] === 1) {                          // ---- analog ----
      var a = decodeAnalogChannels(b);
      data.type = "heartbeat";
      data.deviceInfo = buildDeviceInfo(fPort, "analog", a.battery, a.unixUTC);
      data.sensorInfo = { channels: a.channels };
      return { data: data };
    }

    // ---- RS485 field sweep ----
    var end = b.length - 5;
    var i = 2, slot = 1, flds = [], ok = 0, off = 0, failed = 0;
    while (i < end) {
      var tag = b[i++];
      var type = (tag >> 5) & 0x07;
      var cnt  = tag & 0x1F;
      if (cnt === 0) {
        if (type === 6)      { flds.push({ field: slot++, status: "disabled" });   off++;    }
        else if (type === 7) { flds.push({ field: slot++, status: "read_error" }); failed++; }
        else                 { flds.push({ field: slot++, status: "empty" }); }
        continue;
      }
      var width = (type <= 1) ? 2 : 4;
      var vals = [];
      for (var k = 0; k < cnt; k++) {
        if (i + width > end) { break; }
        vals.push(decodeValue(type, b, i));
        i += width;
      }
      flds.push({ field: slot++, status: "ok", data_type: TYPE_NAME[type], values: vals });
      ok++;
    }
    data.type = "heartbeat";
    data.deviceInfo = buildDeviceInfo(fPort, "rs485", b[b.length - 5], u32(b, b.length - 4));
    data.sensorInfo = { fields: flds, fields_ok: ok, fields_off: off, fields_failed: failed };
    return { data: data };
  }

  // ---------- Port 0x03 : sampling batch ----------
  if (fPort === 0x03) {
    var n = b[0], source = b[1], marker = b[2];
    var srcName = (source === 1) ? "analog" : "rs485";
    var si = { sample_count: n };
    var p, batt, utc;

    if (marker === 0) {                        // BOTH: two streams
      var tA = b[3], tB = b[4]; p = 5;
      var s1 = [], s2 = [];
      for (var s = 0; s < n; s++) { s1.push(fx2(f32(u32(b, p)))); p += 4; }
      for (var s = 0; s < n; s++) { s2.push(fx2(f32(u32(b, p)))); p += 4; }
      if (source === 1) {
        si.channels = [
          { channel: "A", sensor_type: ANALOG_MODE[tA] || "unknown", samples: s1 },
          { channel: "B", sensor_type: ANALOG_MODE[tB] || "unknown", samples: s2 }
        ];
      } else {
        si.fields = [
          { field: 1, data_type: TYPE_NAME[tA] || "unknown", samples: s1 },
          { field: 2, data_type: TYPE_NAME[tB] || "unknown", samples: s2 }
        ];
      }
    } else {                                   // SINGLE: one stream
      var idx = marker, dtype = b[3]; p = 4;
      var samples = [];
      for (var s = 0; s < n; s++) { samples.push(fx2(f32(u32(b, p)))); p += 4; }
      if (source === 1) { si.channel = chAB(idx); si.sensor_type = ANALOG_MODE[dtype] || "unknown"; }
      else              { si.field = idx;        si.data_type   = TYPE_NAME[dtype]   || "unknown"; }
      si.samples = samples;
    }
    batt = b[p]; utc = u32(b, p + 1);
    data.type = "sampling";
    data.deviceInfo = buildDeviceInfo(fPort, srcName, batt, utc);
    data.sensorInfo = si;
    return { data: data };
  }

  // ---------- Port 0x04 : trigger alarm / clear ----------
  // 15-byte frame: [0]trig [1]param [2]event [3-4]value [5-6]min [7-8]max
  //                [9]battery [10-13]UTC [14]source (0=RS485, 1=analog).
  // Old 14-byte frames (no source byte) fall back to the combined label.
  if (fPort === 0x04 && b.length >= 14) {
    data.type = "trigger";
    var devType = (b.length >= 15) ? b[14] : null;   // 0=rs485, 1=analog, null=old fw
    var pNum = (b[1] === 1) ? 2 : 1;                 // field / channel number
    var pLabel;
    if (devType === 1)      { pLabel = "Channel " + (pNum === 1 ? "A" : "B"); }
    else if (devType === 0) { pLabel = "Field " + pNum; }
    else                    { pLabel = (b[1] === 1) ? "Field 2 / Channel B" : "Field 1 / Channel A"; }

    var src = (devType === 1) ? "analog" : (devType === 0) ? "rs485" : null;
    data.deviceInfo = buildDeviceInfo(fPort, src, b[9], u32(b, 10));
    data.deviceInfo.trigNum = b[0];
    data.deviceInfo.event   = (b[2] === 1) ? "ALARM" : "CLEAR";
    data.sensorInfo = {
      param: pLabel,
      value: fx2(i16(b, 3) / 100),
      min:   fx2(i16(b, 5) / 100),
      max:   fx2(i16(b, 7) / 100)
    };
    return { data: data };
  }

  // ---------- Port 0x05 : boot info (no battery) ----------
  if (fPort === 0x05 && b.length >= 10) {
    data.type = "boot";
    data.deviceInfo = buildDeviceInfo(fPort, null, null, u32(b, 6));
    delete data.deviceInfo.battery;
    data.deviceInfo["Firmware Version"] = b[0] + "." + b[1] + "." + b[2];
    data.deviceInfo["Hardware Version"] = b[3] + "." + b[4] + "." + b[5];
    return { data: data };
  }

  // ---------- Ports 0x10-0x15 : config ACK (echo) ----------
  if (fPort >= 0x10 && fPort <= 0x15) {
    var ack = { appliedPort: fPort };
    if (fPort === 0x10) {
      ack.feature = "tx_interval"; ack.interval = u32(b, 0); ack.battery = b[4];
    } else if (fPort === 0x11) {
      ack.feature = "adr"; ack.adr = (b[0] === 1) ? "ON" : "OFF"; ack.battery = b[1];
    } else if (fPort === 0x12) {
      ack.feature = "msg_type"; ack.msgtype = (b[0] === 1) ? "CONFIRMED" : "UNCONFIRMED"; ack.battery = b[1];
    } else if (fPort === 0x13) {
      ack.feature = "msg_info"; ack.adr = (b[0] === 1) ? "ON" : "OFF"; ack.sf = b[1];
      ack.msgtype = (b[2] === 1) ? "CONFIRMED" : "UNCONFIRMED"; ack.battery = b[3];
       } else if (fPort === 0x14) {
      ack.feature = "trigger"; ack.trig = b[0];
      var td = (b.length >= 11) ? b[9] : null;        // source byte (new fw), null = old
      var tp = (b[1] === 1) ? 2 : 1;                  // field / channel number
      ack.param = (td === 1) ? ("Channel " + (tp === 1 ? "A" : "B"))
                : (td === 0) ? ("Field " + tp)
                : ((b[1] === 1) ? "Field 2 / Channel B" : "Field 1 / Channel A");
      if (td !== null) { ack.source = (td === 1) ? "analog" : "rs485"; }
      ack.min = fx2(i16(b, 2) / 100); ack.max = fx2(i16(b, 4) / 100);
      ack.checktime = u16(b, 6); ack.enable = (b[8] === 1) ? "ENABLED" : "DISABLED";
      ack.battery = (b.length >= 11) ? b[10] : b[9];  // battery moves +1 when source byte present
    } else {                                   // 0x15 sampling
      ack.feature = "sampling";
      var sd = (b.length >= 5) ? b[3] : null;        // source byte (new fw)
      if (b[0] === 2) { ack.param = "both"; }
      else {
        var sn = (b[0] === 1) ? 2 : 1;
        ack.param = (sd === 1) ? ("Channel " + (sn === 1 ? "A" : "B"))
                  : (sd === 0) ? ("Field " + sn)
                  : ((b[0] === 1) ? "Field 2 / Channel B" : "Field 1 / Channel A");
      }
      if (sd !== null) { ack.source = (sd === 1) ? "analog" : "rs485"; }
      ack.count = b[1];
      ack.enable = (b[2] === 1) ? "ENABLED" : "DISABLED";
      if (b.length >= 7)      { ack.interval = u16(b, 4); ack.battery = b[6]; }  // source + interval
      else if (b.length >= 5) { ack.battery = b[4]; }                            // source only
      else                    { ack.battery = b[3]; }                            // old firmware
    }
    data.type = "config_ack";
    data.configAck = ack;
    return { data: data };
  }

  // ---------- Ports 8,9,10,12,13,15 : RS485/Modbus downlink replies ----------
  // Reply layout: [0]=2 [1]=0x02 [2]=port [3]=state <feature...> UTC(4).
  // state: 0 ok, 1 failed, 2 invalid.
  if (fPort === 8 || fPort === 9 || fPort === 10 ||
      fPort === 12 || fPort === 13 || fPort === 15) {
    data.type = "modbus_ack";
    data.deviceInfo = modbusDeviceInfo(fPort, b);
    var st = b[3];
    var m = { state: st, state_text: stateText(st) };

    if (fPort === 10 || fPort === 15) {          // field config: write / read-back
      m.feature   = (fPort === 10) ? "field_config_set" : "field_config_read";
      m.index     = b[4];
      m.slaveId   = b[5];
      m.fc        = b[6];
      m.enable    = b[7];
      m.data_type = TYPE_NAME[b[8]] || ("type" + b[8]);
      m.numParams = b[9];
      m.address   = u16(b, 10);
    } else if (fPort === 8 || fPort === 9) {     // coil write / register write
      m.feature = (fPort === 8) ? "coil_write" : "register_write";
      m.slaveId = b[4];
      m.numReg  = b[5];
      m.address = u16(b, 6);
      m.value   = u16(b, 8);
    } else if (fPort === 13) {                   // live register read
      m.feature = "register_read";
      var rtag = b[4];
      var rt = (rtag >> 5) & 0x07, rc = rtag & 0x1F;
      if (rt === 7 && rc === 0) {
        m.read = "error";
      } else {
        m.data_type = TYPE_NAME[rt] || ("type" + rt);
        var w = (rt <= 1) ? 2 : 4, vals2 = [], q = 5;
        for (var mm = 0; mm < rc; mm++) { vals2.push(decodeValue(rt, b, q)); q += w; }
        m.values = vals2;
      }
    } else if (fPort === 12) {                   // baud + parity
      m.feature = "baud";
      m.baud    = u16(b, 4);
      m.parity  = b[6];
    }

    data.modbusAck = m;
    return { data: data };
  }

  // ---------- Unknown port ----------
  return { data: { fPort: fPort }, warnings: ["Unknown fPort " + fPort] };
}

// ===================================================================
// DOWNLINK ENCODER  (JSON -> bytes; set "port" in the JSON = FPort field)
//   Modbus:
//     8  {"port":8,"slaveId":1,"numReg":1,"address":1,"value":1}
//     9  {"port":9,"slaveId":1,"numReg":1,"address":1,"value":1234}  // numReg:2 -> 32-bit
//     10 {"port":10,"index":1,"slaveId":1,"fc":4,"enable":1,"dataType":1,"numParams":2,"address":1}
//     12 {"port":12,"baud":9600,"parity":0}
//     13 {"port":13,"slaveId":1,"fc":4,"dataType":1,"numParams":2,"address":1}
//     15 {"port":15,"index":1}
//   Config:
//     16 {"port":16,"interval":300}
//     17 {"port":17,"adr":1}
//     18 {"port":18,"msgtype":1}
//     19 {"port":19,"adr":1,"sf":7,"msgtype":1}
//     20 {"port":20,"trig":1,"param":0,"min":2.2,"max":6.6,"checktime":30,"enable":1}
//     21 {"port":21,"param":0,"count":2,"enable":1}
// ===================================================================
function encodeDownlink(input) {
  var d = input.data || {};
  // ChirpStack does not reliably pass input.fPort here, so read "port" from
  // the JSON first (set it equal to the FPort field), fall back to input.fPort.
  var port = (d.port !== undefined) ? d.port :
             (d.fPort !== undefined) ? d.fPort : input.fPort;
  function u16b(v){ return [(v >> 8) & 0xFF, v & 0xFF]; }
  function u32b(v){ return [(v>>>24)&0xFF,(v>>>16)&0xFF,(v>>>8)&0xFF,v&0xFF]; }
  var bytes = [];
  switch (port) {
    // ---- Modbus / RS485 ----
    case 12:  bytes = u16b(d.baud & 0xFFFF).concat([d.parity & 0xFF]); break; // baud + parity
    case 10:  bytes = [d.index&0xFF, d.slaveId&0xFF, d.fc&0xFF, d.enable&0xFF,
                       d.dataType&0xFF, d.numParams&0xFF].concat(u16b(d.address & 0xFFFF)); break;
    case 15:  bytes = [d.index & 0xFF]; break;
    case 13:  bytes = [d.slaveId&0xFF, d.fc&0xFF, d.dataType&0xFF, d.numParams&0xFF]
                      .concat(u16b(d.address & 0xFFFF)); break;
    case 8:
    case 9:
      var nreg = d.numReg & 0xFF;
      bytes = [d.slaveId&0xFF, nreg].concat(u16b(d.address & 0xFFFF));
      bytes = (nreg === 1) ? bytes.concat(u16b(d.value & 0xFFFF))
                           : bytes.concat(u32b(d.value >>> 0));
      break;
    // ---- Config ----
    case 16:  bytes = u32b(d.interval >>> 0); break;                          // TX interval
    case 17:  bytes = [d.adr & 1]; break;                                     // ADR
    case 18:  bytes = [d.msgtype & 1]; break;                                 // msg type
    case 19:  bytes = [d.adr & 1, d.sf & 0xFF, d.msgtype & 1]; break;         // adr+sf+type
    case 20:                                                                  // trigger
      var mn = Math.round(d.min * 100), mx = Math.round(d.max * 100), ct = d.checktime & 0xFFFF;
      bytes = [d.trig & 0xFF, d.param & 0xFF]
              .concat(u16b(mn & 0xFFFF)).concat(u16b(mx & 0xFFFF))
              .concat(u16b(ct)).concat([d.enable & 1]);
      break;
    case 21:
      bytes = [d.param & 0xFF, d.count & 0xFF, d.enable & 1];
      if (d.interval !== undefined) { bytes = bytes.concat(u16b(d.interval & 0xFFFF)); }
      break;
    default:
      return { bytes: [], fPort: port, errors: ["unknown downlink port " + port] };
  }
  return { bytes: bytes, fPort: port };
}

// Milesight / ChirpStack v3 entry point
function Decode(fPort, bytes, variables) {
  return decodeUplink({ bytes: bytes, fPort: fPort }).data;
}

// Milesight / ChirpStack v3 downlink entry point
function Encode(fPort, obj) {
  var r = encodeDownlink({ data: obj, fPort: fPort });
  return r.bytes;
}
