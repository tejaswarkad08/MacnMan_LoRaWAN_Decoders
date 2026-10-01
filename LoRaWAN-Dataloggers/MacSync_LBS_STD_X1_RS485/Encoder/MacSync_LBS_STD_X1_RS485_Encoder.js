// ===================================================================
// MacSync_LBS_STD_X1 RS485 / ANALOG node - standalone DOWNLINK ENCODER
// Same JSON keys as the codec files; see the .md for the command table.
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

