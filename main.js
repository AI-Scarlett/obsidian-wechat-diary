/*
 * WeChat Diary v0.1.0 — 对着微信说话, 日记直接落进你的 Obsidian 库。
 *
 * 这是 wechat-diary (Python 版, github.com/ArtemisLin/wechat-diary) 的插件形态。
 * 纯 JS 手写, 无构建步骤——想改它, 把这个文件丢给任何 AI 就行。
 *
 * 工作原理: 扫码绑定微信 bot → 长轮询收消息(腾讯官方 iLink 协议, 直连不走代理)
 * → 意图识别(记日记/闲聊/撤回/结束) → 追加写入 vault 里的 日记/YYYY/YYYY-MM-DD.md。
 * 写入格式与 Python 版逐字节一致(docs/data-contract.md), 两种形态可随时互迁。
 * bot token 与 AI Key 存 Obsidian 密钥存储(不进 vault, 不被同步盘带走)。
 *
 * 文件结构: [内嵌 qrcode-generator 库] → [插件本体] → module.exports。
 */
//---------------------------------------------------------------------
//
// QR Code Generator for JavaScript
//
// Copyright (c) 2009 Kazuhiko Arase
//
// URL: http://www.d-project.com/
//
// Licensed under the MIT license:
//  http://www.opensource.org/licenses/mit-license.php
//
// The word 'QR Code' is registered trademark of
// DENSO WAVE INCORPORATED
//  http://www.denso-wave.com/qrcode/faqpatent-e.html
//
//---------------------------------------------------------------------

var qrcode = function() {

  //---------------------------------------------------------------------
  // qrcode
  //---------------------------------------------------------------------

  /**
   * qrcode
   * @param typeNumber 1 to 40
   * @param errorCorrectionLevel 'L','M','Q','H'
   */
  var qrcode = function(typeNumber, errorCorrectionLevel) {

    var PAD0 = 0xEC;
    var PAD1 = 0x11;

    var _typeNumber = typeNumber;
    var _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
    var _modules = null;
    var _moduleCount = 0;
    var _dataCache = null;
    var _dataList = [];

    var _this = {};

    var makeImpl = function(test, maskPattern) {

      _moduleCount = _typeNumber * 4 + 17;
      _modules = function(moduleCount) {
        var modules = new Array(moduleCount);
        for (var row = 0; row < moduleCount; row += 1) {
          modules[row] = new Array(moduleCount);
          for (var col = 0; col < moduleCount; col += 1) {
            modules[row][col] = null;
          }
        }
        return modules;
      }(_moduleCount);

      setupPositionProbePattern(0, 0);
      setupPositionProbePattern(_moduleCount - 7, 0);
      setupPositionProbePattern(0, _moduleCount - 7);
      setupPositionAdjustPattern();
      setupTimingPattern();
      setupTypeInfo(test, maskPattern);

      if (_typeNumber >= 7) {
        setupTypeNumber(test);
      }

      if (_dataCache == null) {
        _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
      }

      mapData(_dataCache, maskPattern);
    };

    var setupPositionProbePattern = function(row, col) {

      for (var r = -1; r <= 7; r += 1) {

        if (row + r <= -1 || _moduleCount <= row + r) continue;

        for (var c = -1; c <= 7; c += 1) {

          if (col + c <= -1 || _moduleCount <= col + c) continue;

          if ( (0 <= r && r <= 6 && (c == 0 || c == 6) )
              || (0 <= c && c <= 6 && (r == 0 || r == 6) )
              || (2 <= r && r <= 4 && 2 <= c && c <= 4) ) {
            _modules[row + r][col + c] = true;
          } else {
            _modules[row + r][col + c] = false;
          }
        }
      }
    };

    var getBestMaskPattern = function() {

      var minLostPoint = 0;
      var pattern = 0;

      for (var i = 0; i < 8; i += 1) {

        makeImpl(true, i);

        var lostPoint = QRUtil.getLostPoint(_this);

        if (i == 0 || minLostPoint > lostPoint) {
          minLostPoint = lostPoint;
          pattern = i;
        }
      }

      return pattern;
    };

    var setupTimingPattern = function() {

      for (var r = 8; r < _moduleCount - 8; r += 1) {
        if (_modules[r][6] != null) {
          continue;
        }
        _modules[r][6] = (r % 2 == 0);
      }

      for (var c = 8; c < _moduleCount - 8; c += 1) {
        if (_modules[6][c] != null) {
          continue;
        }
        _modules[6][c] = (c % 2 == 0);
      }
    };

    var setupPositionAdjustPattern = function() {

      var pos = QRUtil.getPatternPosition(_typeNumber);

      for (var i = 0; i < pos.length; i += 1) {

        for (var j = 0; j < pos.length; j += 1) {

          var row = pos[i];
          var col = pos[j];

          if (_modules[row][col] != null) {
            continue;
          }

          for (var r = -2; r <= 2; r += 1) {

            for (var c = -2; c <= 2; c += 1) {

              if (r == -2 || r == 2 || c == -2 || c == 2
                  || (r == 0 && c == 0) ) {
                _modules[row + r][col + c] = true;
              } else {
                _modules[row + r][col + c] = false;
              }
            }
          }
        }
      }
    };

    var setupTypeNumber = function(test) {

      var bits = QRUtil.getBCHTypeNumber(_typeNumber);

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
      }

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
      }
    };

    var setupTypeInfo = function(test, maskPattern) {

      var data = (_errorCorrectionLevel << 3) | maskPattern;
      var bits = QRUtil.getBCHTypeInfo(data);

      // vertical
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 6) {
          _modules[i][8] = mod;
        } else if (i < 8) {
          _modules[i + 1][8] = mod;
        } else {
          _modules[_moduleCount - 15 + i][8] = mod;
        }
      }

      // horizontal
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 8) {
          _modules[8][_moduleCount - i - 1] = mod;
        } else if (i < 9) {
          _modules[8][15 - i - 1 + 1] = mod;
        } else {
          _modules[8][15 - i - 1] = mod;
        }
      }

      // fixed module
      _modules[_moduleCount - 8][8] = (!test);
    };

    var mapData = function(data, maskPattern) {

      var inc = -1;
      var row = _moduleCount - 1;
      var bitIndex = 7;
      var byteIndex = 0;
      var maskFunc = QRUtil.getMaskFunction(maskPattern);

      for (var col = _moduleCount - 1; col > 0; col -= 2) {

        if (col == 6) col -= 1;

        while (true) {

          for (var c = 0; c < 2; c += 1) {

            if (_modules[row][col - c] == null) {

              var dark = false;

              if (byteIndex < data.length) {
                dark = ( ( (data[byteIndex] >>> bitIndex) & 1) == 1);
              }

              var mask = maskFunc(row, col - c);

              if (mask) {
                dark = !dark;
              }

              _modules[row][col - c] = dark;
              bitIndex -= 1;

              if (bitIndex == -1) {
                byteIndex += 1;
                bitIndex = 7;
              }
            }
          }

          row += inc;

          if (row < 0 || _moduleCount <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    };

    var createBytes = function(buffer, rsBlocks) {

      var offset = 0;

      var maxDcCount = 0;
      var maxEcCount = 0;

      var dcdata = new Array(rsBlocks.length);
      var ecdata = new Array(rsBlocks.length);

      for (var r = 0; r < rsBlocks.length; r += 1) {

        var dcCount = rsBlocks[r].dataCount;
        var ecCount = rsBlocks[r].totalCount - dcCount;

        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);

        dcdata[r] = new Array(dcCount);

        for (var i = 0; i < dcdata[r].length; i += 1) {
          dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
        }
        offset += dcCount;

        var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);

        var modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (var i = 0; i < ecdata[r].length; i += 1) {
          var modIndex = i + modPoly.getLength() - ecdata[r].length;
          ecdata[r][i] = (modIndex >= 0)? modPoly.getAt(modIndex) : 0;
        }
      }

      var totalCodeCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalCodeCount += rsBlocks[i].totalCount;
      }

      var data = new Array(totalCodeCount);
      var index = 0;

      for (var i = 0; i < maxDcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < dcdata[r].length) {
            data[index] = dcdata[r][i];
            index += 1;
          }
        }
      }

      for (var i = 0; i < maxEcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < ecdata[r].length) {
            data[index] = ecdata[r][i];
            index += 1;
          }
        }
      }

      return data;
    };

    var createData = function(typeNumber, errorCorrectionLevel, dataList) {

      var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);

      var buffer = qrBitBuffer();

      for (var i = 0; i < dataList.length; i += 1) {
        var data = dataList[i];
        buffer.put(data.getMode(), 4);
        buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
        data.write(buffer);
      }

      // calc num max data.
      var totalDataCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalDataCount += rsBlocks[i].dataCount;
      }

      if (buffer.getLengthInBits() > totalDataCount * 8) {
        throw 'code length overflow. ('
          + buffer.getLengthInBits()
          + '>'
          + totalDataCount * 8
          + ')';
      }

      // end code
      if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
        buffer.put(0, 4);
      }

      // padding
      while (buffer.getLengthInBits() % 8 != 0) {
        buffer.putBit(false);
      }

      // padding
      while (true) {

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD0, 8);

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD1, 8);
      }

      return createBytes(buffer, rsBlocks);
    };

    _this.addData = function(data, mode) {

      mode = mode || 'Byte';

      var newData = null;

      switch(mode) {
      case 'Numeric' :
        newData = qrNumber(data);
        break;
      case 'Alphanumeric' :
        newData = qrAlphaNum(data);
        break;
      case 'Byte' :
        newData = qr8BitByte(data);
        break;
      case 'Kanji' :
        newData = qrKanji(data);
        break;
      default :
        throw 'mode:' + mode;
      }

      _dataList.push(newData);
      _dataCache = null;
    };

    _this.isDark = function(row, col) {
      if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
        throw row + ',' + col;
      }
      return _modules[row][col];
    };

    _this.getModuleCount = function() {
      return _moduleCount;
    };

    _this.make = function() {
      if (_typeNumber < 1) {
        var typeNumber = 1;

        for (; typeNumber < 40; typeNumber++) {
          var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
          var buffer = qrBitBuffer();

          for (var i = 0; i < _dataList.length; i++) {
            var data = _dataList[i];
            buffer.put(data.getMode(), 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
            data.write(buffer);
          }

          var totalDataCount = 0;
          for (var i = 0; i < rsBlocks.length; i++) {
            totalDataCount += rsBlocks[i].dataCount;
          }

          if (buffer.getLengthInBits() <= totalDataCount * 8) {
            break;
          }
        }

        _typeNumber = typeNumber;
      }

      makeImpl(false, getBestMaskPattern() );
    };

    _this.createTableTag = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var qrHtml = '';

      qrHtml += '<table style="';
      qrHtml += ' border-width: 0px; border-style: none;';
      qrHtml += ' border-collapse: collapse;';
      qrHtml += ' padding: 0px; margin: ' + margin + 'px;';
      qrHtml += '">';
      qrHtml += '<tbody>';

      for (var r = 0; r < _this.getModuleCount(); r += 1) {

        qrHtml += '<tr>';

        for (var c = 0; c < _this.getModuleCount(); c += 1) {
          qrHtml += '<td style="';
          qrHtml += ' border-width: 0px; border-style: none;';
          qrHtml += ' border-collapse: collapse;';
          qrHtml += ' padding: 0px; margin: 0px;';
          qrHtml += ' width: ' + cellSize + 'px;';
          qrHtml += ' height: ' + cellSize + 'px;';
          qrHtml += ' background-color: ';
          qrHtml += _this.isDark(r, c)? '#000000' : '#ffffff';
          qrHtml += ';';
          qrHtml += '"/>';
        }

        qrHtml += '</tr>';
      }

      qrHtml += '</tbody>';
      qrHtml += '</table>';

      return qrHtml;
    };

    _this.createSvgTag = function(cellSize, margin, alt, title) {

      var opts = {};
      if (typeof arguments[0] == 'object') {
        // Called by options.
        opts = arguments[0];
        // overwrite cellSize and margin.
        cellSize = opts.cellSize;
        margin = opts.margin;
        alt = opts.alt;
        title = opts.title;
      }

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      // Compose alt property surrogate
      alt = (typeof alt === 'string') ? {text: alt} : alt || {};
      alt.text = alt.text || null;
      alt.id = (alt.text) ? alt.id || 'qrcode-description' : null;

      // Compose title property surrogate
      title = (typeof title === 'string') ? {text: title} : title || {};
      title.text = title.text || null;
      title.id = (title.text) ? title.id || 'qrcode-title' : null;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var c, mc, r, mr, qrSvg='', rect;

      rect = 'l' + cellSize + ',0 0,' + cellSize +
        ' -' + cellSize + ',0 0,-' + cellSize + 'z ';

      qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
      qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : '';
      qrSvg += ' viewBox="0 0 ' + size + ' ' + size + '" ';
      qrSvg += ' preserveAspectRatio="xMinYMin meet"';
      qrSvg += (title.text || alt.text) ? ' role="img" aria-labelledby="' +
          escapeXml([title.id, alt.id].join(' ').trim() ) + '"' : '';
      qrSvg += '>';
      qrSvg += (title.text) ? '<title id="' + escapeXml(title.id) + '">' +
          escapeXml(title.text) + '</title>' : '';
      qrSvg += (alt.text) ? '<description id="' + escapeXml(alt.id) + '">' +
          escapeXml(alt.text) + '</description>' : '';
      qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
      qrSvg += '<path d="';

      for (r = 0; r < _this.getModuleCount(); r += 1) {
        mr = r * cellSize + margin;
        for (c = 0; c < _this.getModuleCount(); c += 1) {
          if (_this.isDark(r, c) ) {
            mc = c*cellSize+margin;
            qrSvg += 'M' + mc + ',' + mr + rect;
          }
        }
      }

      qrSvg += '" stroke="transparent" fill="black"/>';
      qrSvg += '</svg>';

      return qrSvg;
    };

    _this.createDataURL = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      return createDataURL(size, size, function(x, y) {
        if (min <= x && x < max && min <= y && y < max) {
          var c = Math.floor( (x - min) / cellSize);
          var r = Math.floor( (y - min) / cellSize);
          return _this.isDark(r, c)? 0 : 1;
        } else {
          return 1;
        }
      } );
    };

    _this.createImgTag = function(cellSize, margin, alt) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;

      var img = '';
      img += '<img';
      img += '\u0020src="';
      img += _this.createDataURL(cellSize, margin);
      img += '"';
      img += '\u0020width="';
      img += size;
      img += '"';
      img += '\u0020height="';
      img += size;
      img += '"';
      if (alt) {
        img += '\u0020alt="';
        img += escapeXml(alt);
        img += '"';
      }
      img += '/>';

      return img;
    };

    var escapeXml = function(s) {
      var escaped = '';
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charAt(i);
        switch(c) {
        case '<': escaped += '&lt;'; break;
        case '>': escaped += '&gt;'; break;
        case '&': escaped += '&amp;'; break;
        case '"': escaped += '&quot;'; break;
        default : escaped += c; break;
        }
      }
      return escaped;
    };

    var _createHalfASCII = function(margin) {
      var cellSize = 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r1, r2, p;

      var blocks = {
        '██': '█',
        '█ ': '▀',
        ' █': '▄',
        '  ': ' '
      };

      var blocksLastLineNoMargin = {
        '██': '▀',
        '█ ': '▀',
        ' █': ' ',
        '  ': ' '
      };

      var ascii = '';
      for (y = 0; y < size; y += 2) {
        r1 = Math.floor((y - min) / cellSize);
        r2 = Math.floor((y + 1 - min) / cellSize);
        for (x = 0; x < size; x += 1) {
          p = '█';

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
            p = ' ';
          }

          if (min <= x && x < max && min <= y+1 && y+1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
            p += ' ';
          }
          else {
            p += '█';
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          ascii += (margin < 1 && y+1 >= max) ? blocksLastLineNoMargin[p] : blocks[p];
        }

        ascii += '\n';
      }

      if (size % 2 && margin > 0) {
        return ascii.substring(0, ascii.length - size - 1) + Array(size+1).join('▀');
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.createASCII = function(cellSize, margin) {
      cellSize = cellSize || 1;

      if (cellSize < 2) {
        return _createHalfASCII(margin);
      }

      cellSize -= 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r, p;

      var white = Array(cellSize+1).join('██');
      var black = Array(cellSize+1).join('  ');

      var ascii = '';
      var line = '';
      for (y = 0; y < size; y += 1) {
        r = Math.floor( (y - min) / cellSize);
        line = '';
        for (x = 0; x < size; x += 1) {
          p = 1;

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
            p = 0;
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          line += p ? white : black;
        }

        for (r = 0; r < cellSize; r += 1) {
          ascii += line + '\n';
        }
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.renderTo2dContext = function(context, cellSize) {
      cellSize = cellSize || 2;
      var length = _this.getModuleCount();
      for (var row = 0; row < length; row++) {
        for (var col = 0; col < length; col++) {
          context.fillStyle = _this.isDark(row, col) ? 'black' : 'white';
          context.fillRect(row * cellSize, col * cellSize, cellSize, cellSize);
        }
      }
    }

    return _this;
  };

  //---------------------------------------------------------------------
  // qrcode.stringToBytes
  //---------------------------------------------------------------------

  qrcode.stringToBytesFuncs = {
    'default' : function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        bytes.push(c & 0xff);
      }
      return bytes;
    }
  };

  qrcode.stringToBytes = qrcode.stringToBytesFuncs['default'];

  //---------------------------------------------------------------------
  // qrcode.createStringToBytes
  //---------------------------------------------------------------------

  /**
   * @param unicodeData base64 string of byte array.
   * [16bit Unicode],[16bit Bytes], ...
   * @param numChars
   */
  qrcode.createStringToBytes = function(unicodeData, numChars) {

    // create conversion map.

    var unicodeMap = function() {

      var bin = base64DecodeInputStream(unicodeData);
      var read = function() {
        var b = bin.read();
        if (b == -1) throw 'eof';
        return b;
      };

      var count = 0;
      var unicodeMap = {};
      while (true) {
        var b0 = bin.read();
        if (b0 == -1) break;
        var b1 = read();
        var b2 = read();
        var b3 = read();
        var k = String.fromCharCode( (b0 << 8) | b1);
        var v = (b2 << 8) | b3;
        unicodeMap[k] = v;
        count += 1;
      }
      if (count != numChars) {
        throw count + ' != ' + numChars;
      }

      return unicodeMap;
    }();

    var unknownChar = '?'.charCodeAt(0);

    return function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        if (c < 128) {
          bytes.push(c);
        } else {
          var b = unicodeMap[s.charAt(i)];
          if (typeof b == 'number') {
            if ( (b & 0xff) == b) {
              // 1byte
              bytes.push(b);
            } else {
              // 2bytes
              bytes.push(b >>> 8);
              bytes.push(b & 0xff);
            }
          } else {
            bytes.push(unknownChar);
          }
        }
      }
      return bytes;
    };
  };

  //---------------------------------------------------------------------
  // QRMode
  //---------------------------------------------------------------------

  var QRMode = {
    MODE_NUMBER :    1 << 0,
    MODE_ALPHA_NUM : 1 << 1,
    MODE_8BIT_BYTE : 1 << 2,
    MODE_KANJI :     1 << 3
  };

  //---------------------------------------------------------------------
  // QRErrorCorrectionLevel
  //---------------------------------------------------------------------

  var QRErrorCorrectionLevel = {
    L : 1,
    M : 0,
    Q : 3,
    H : 2
  };

  //---------------------------------------------------------------------
  // QRMaskPattern
  //---------------------------------------------------------------------

  var QRMaskPattern = {
    PATTERN000 : 0,
    PATTERN001 : 1,
    PATTERN010 : 2,
    PATTERN011 : 3,
    PATTERN100 : 4,
    PATTERN101 : 5,
    PATTERN110 : 6,
    PATTERN111 : 7
  };

  //---------------------------------------------------------------------
  // QRUtil
  //---------------------------------------------------------------------

  var QRUtil = function() {

    var PATTERN_POSITION_TABLE = [
      [],
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38],
      [6, 24, 42],
      [6, 26, 46],
      [6, 28, 50],
      [6, 30, 54],
      [6, 32, 58],
      [6, 34, 62],
      [6, 26, 46, 66],
      [6, 26, 48, 70],
      [6, 26, 50, 74],
      [6, 30, 54, 78],
      [6, 30, 56, 82],
      [6, 30, 58, 86],
      [6, 34, 62, 90],
      [6, 28, 50, 72, 94],
      [6, 26, 50, 74, 98],
      [6, 30, 54, 78, 102],
      [6, 28, 54, 80, 106],
      [6, 32, 58, 84, 110],
      [6, 30, 58, 86, 114],
      [6, 34, 62, 90, 118],
      [6, 26, 50, 74, 98, 122],
      [6, 30, 54, 78, 102, 126],
      [6, 26, 52, 78, 104, 130],
      [6, 30, 56, 82, 108, 134],
      [6, 34, 60, 86, 112, 138],
      [6, 30, 58, 86, 114, 142],
      [6, 34, 62, 90, 118, 146],
      [6, 30, 54, 78, 102, 126, 150],
      [6, 24, 50, 76, 102, 128, 154],
      [6, 28, 54, 80, 106, 132, 158],
      [6, 32, 58, 84, 110, 136, 162],
      [6, 26, 54, 82, 110, 138, 166],
      [6, 30, 58, 86, 114, 142, 170]
    ];
    var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
    var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
    var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

    var _this = {};

    var getBCHDigit = function(data) {
      var digit = 0;
      while (data != 0) {
        digit += 1;
        data >>>= 1;
      }
      return digit;
    };

    _this.getBCHTypeInfo = function(data) {
      var d = data << 10;
      while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
        d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15) ) );
      }
      return ( (data << 10) | d) ^ G15_MASK;
    };

    _this.getBCHTypeNumber = function(data) {
      var d = data << 12;
      while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
        d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18) ) );
      }
      return (data << 12) | d;
    };

    _this.getPatternPosition = function(typeNumber) {
      return PATTERN_POSITION_TABLE[typeNumber - 1];
    };

    _this.getMaskFunction = function(maskPattern) {

      switch (maskPattern) {

      case QRMaskPattern.PATTERN000 :
        return function(i, j) { return (i + j) % 2 == 0; };
      case QRMaskPattern.PATTERN001 :
        return function(i, j) { return i % 2 == 0; };
      case QRMaskPattern.PATTERN010 :
        return function(i, j) { return j % 3 == 0; };
      case QRMaskPattern.PATTERN011 :
        return function(i, j) { return (i + j) % 3 == 0; };
      case QRMaskPattern.PATTERN100 :
        return function(i, j) { return (Math.floor(i / 2) + Math.floor(j / 3) ) % 2 == 0; };
      case QRMaskPattern.PATTERN101 :
        return function(i, j) { return (i * j) % 2 + (i * j) % 3 == 0; };
      case QRMaskPattern.PATTERN110 :
        return function(i, j) { return ( (i * j) % 2 + (i * j) % 3) % 2 == 0; };
      case QRMaskPattern.PATTERN111 :
        return function(i, j) { return ( (i * j) % 3 + (i + j) % 2) % 2 == 0; };

      default :
        throw 'bad maskPattern:' + maskPattern;
      }
    };

    _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
      var a = qrPolynomial([1], 0);
      for (var i = 0; i < errorCorrectLength; i += 1) {
        a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0) );
      }
      return a;
    };

    _this.getLengthInBits = function(mode, type) {

      if (1 <= type && type < 10) {

        // 1 - 9

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 10;
        case QRMode.MODE_ALPHA_NUM : return 9;
        case QRMode.MODE_8BIT_BYTE : return 8;
        case QRMode.MODE_KANJI     : return 8;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 27) {

        // 10 - 26

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 12;
        case QRMode.MODE_ALPHA_NUM : return 11;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 10;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 41) {

        // 27 - 40

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 14;
        case QRMode.MODE_ALPHA_NUM : return 13;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 12;
        default :
          throw 'mode:' + mode;
        }

      } else {
        throw 'type:' + type;
      }
    };

    _this.getLostPoint = function(qrcode) {

      var moduleCount = qrcode.getModuleCount();

      var lostPoint = 0;

      // LEVEL1

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount; col += 1) {

          var sameCount = 0;
          var dark = qrcode.isDark(row, col);

          for (var r = -1; r <= 1; r += 1) {

            if (row + r < 0 || moduleCount <= row + r) {
              continue;
            }

            for (var c = -1; c <= 1; c += 1) {

              if (col + c < 0 || moduleCount <= col + c) {
                continue;
              }

              if (r == 0 && c == 0) {
                continue;
              }

              if (dark == qrcode.isDark(row + r, col + c) ) {
                sameCount += 1;
              }
            }
          }

          if (sameCount > 5) {
            lostPoint += (3 + sameCount - 5);
          }
        }
      };

      // LEVEL2

      for (var row = 0; row < moduleCount - 1; row += 1) {
        for (var col = 0; col < moduleCount - 1; col += 1) {
          var count = 0;
          if (qrcode.isDark(row, col) ) count += 1;
          if (qrcode.isDark(row + 1, col) ) count += 1;
          if (qrcode.isDark(row, col + 1) ) count += 1;
          if (qrcode.isDark(row + 1, col + 1) ) count += 1;
          if (count == 0 || count == 4) {
            lostPoint += 3;
          }
        }
      }

      // LEVEL3

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount - 6; col += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row, col + 1)
              &&  qrcode.isDark(row, col + 2)
              &&  qrcode.isDark(row, col + 3)
              &&  qrcode.isDark(row, col + 4)
              && !qrcode.isDark(row, col + 5)
              &&  qrcode.isDark(row, col + 6) ) {
            lostPoint += 40;
          }
        }
      }

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount - 6; row += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row + 1, col)
              &&  qrcode.isDark(row + 2, col)
              &&  qrcode.isDark(row + 3, col)
              &&  qrcode.isDark(row + 4, col)
              && !qrcode.isDark(row + 5, col)
              &&  qrcode.isDark(row + 6, col) ) {
            lostPoint += 40;
          }
        }
      }

      // LEVEL4

      var darkCount = 0;

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount; row += 1) {
          if (qrcode.isDark(row, col) ) {
            darkCount += 1;
          }
        }
      }

      var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;

      return lostPoint;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // QRMath
  //---------------------------------------------------------------------

  var QRMath = function() {

    var EXP_TABLE = new Array(256);
    var LOG_TABLE = new Array(256);

    // initialize tables
    for (var i = 0; i < 8; i += 1) {
      EXP_TABLE[i] = 1 << i;
    }
    for (var i = 8; i < 256; i += 1) {
      EXP_TABLE[i] = EXP_TABLE[i - 4]
        ^ EXP_TABLE[i - 5]
        ^ EXP_TABLE[i - 6]
        ^ EXP_TABLE[i - 8];
    }
    for (var i = 0; i < 255; i += 1) {
      LOG_TABLE[EXP_TABLE[i] ] = i;
    }

    var _this = {};

    _this.glog = function(n) {

      if (n < 1) {
        throw 'glog(' + n + ')';
      }

      return LOG_TABLE[n];
    };

    _this.gexp = function(n) {

      while (n < 0) {
        n += 255;
      }

      while (n >= 256) {
        n -= 255;
      }

      return EXP_TABLE[n];
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrPolynomial
  //---------------------------------------------------------------------

  function qrPolynomial(num, shift) {

    if (typeof num.length == 'undefined') {
      throw num.length + '/' + shift;
    }

    var _num = function() {
      var offset = 0;
      while (offset < num.length && num[offset] == 0) {
        offset += 1;
      }
      var _num = new Array(num.length - offset + shift);
      for (var i = 0; i < num.length - offset; i += 1) {
        _num[i] = num[i + offset];
      }
      return _num;
    }();

    var _this = {};

    _this.getAt = function(index) {
      return _num[index];
    };

    _this.getLength = function() {
      return _num.length;
    };

    _this.multiply = function(e) {

      var num = new Array(_this.getLength() + e.getLength() - 1);

      for (var i = 0; i < _this.getLength(); i += 1) {
        for (var j = 0; j < e.getLength(); j += 1) {
          num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i) ) + QRMath.glog(e.getAt(j) ) );
        }
      }

      return qrPolynomial(num, 0);
    };

    _this.mod = function(e) {

      if (_this.getLength() - e.getLength() < 0) {
        return _this;
      }

      var ratio = QRMath.glog(_this.getAt(0) ) - QRMath.glog(e.getAt(0) );

      var num = new Array(_this.getLength() );
      for (var i = 0; i < _this.getLength(); i += 1) {
        num[i] = _this.getAt(i);
      }

      for (var i = 0; i < e.getLength(); i += 1) {
        num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i) ) + ratio);
      }

      // recursive call
      return qrPolynomial(num, 0).mod(e);
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // QRRSBlock
  //---------------------------------------------------------------------

  var QRRSBlock = function() {

    var RS_BLOCK_TABLE = [

      // L
      // M
      // Q
      // H

      // 1
      [1, 26, 19],
      [1, 26, 16],
      [1, 26, 13],
      [1, 26, 9],

      // 2
      [1, 44, 34],
      [1, 44, 28],
      [1, 44, 22],
      [1, 44, 16],

      // 3
      [1, 70, 55],
      [1, 70, 44],
      [2, 35, 17],
      [2, 35, 13],

      // 4
      [1, 100, 80],
      [2, 50, 32],
      [2, 50, 24],
      [4, 25, 9],

      // 5
      [1, 134, 108],
      [2, 67, 43],
      [2, 33, 15, 2, 34, 16],
      [2, 33, 11, 2, 34, 12],

      // 6
      [2, 86, 68],
      [4, 43, 27],
      [4, 43, 19],
      [4, 43, 15],

      // 7
      [2, 98, 78],
      [4, 49, 31],
      [2, 32, 14, 4, 33, 15],
      [4, 39, 13, 1, 40, 14],

      // 8
      [2, 121, 97],
      [2, 60, 38, 2, 61, 39],
      [4, 40, 18, 2, 41, 19],
      [4, 40, 14, 2, 41, 15],

      // 9
      [2, 146, 116],
      [3, 58, 36, 2, 59, 37],
      [4, 36, 16, 4, 37, 17],
      [4, 36, 12, 4, 37, 13],

      // 10
      [2, 86, 68, 2, 87, 69],
      [4, 69, 43, 1, 70, 44],
      [6, 43, 19, 2, 44, 20],
      [6, 43, 15, 2, 44, 16],

      // 11
      [4, 101, 81],
      [1, 80, 50, 4, 81, 51],
      [4, 50, 22, 4, 51, 23],
      [3, 36, 12, 8, 37, 13],

      // 12
      [2, 116, 92, 2, 117, 93],
      [6, 58, 36, 2, 59, 37],
      [4, 46, 20, 6, 47, 21],
      [7, 42, 14, 4, 43, 15],

      // 13
      [4, 133, 107],
      [8, 59, 37, 1, 60, 38],
      [8, 44, 20, 4, 45, 21],
      [12, 33, 11, 4, 34, 12],

      // 14
      [3, 145, 115, 1, 146, 116],
      [4, 64, 40, 5, 65, 41],
      [11, 36, 16, 5, 37, 17],
      [11, 36, 12, 5, 37, 13],

      // 15
      [5, 109, 87, 1, 110, 88],
      [5, 65, 41, 5, 66, 42],
      [5, 54, 24, 7, 55, 25],
      [11, 36, 12, 7, 37, 13],

      // 16
      [5, 122, 98, 1, 123, 99],
      [7, 73, 45, 3, 74, 46],
      [15, 43, 19, 2, 44, 20],
      [3, 45, 15, 13, 46, 16],

      // 17
      [1, 135, 107, 5, 136, 108],
      [10, 74, 46, 1, 75, 47],
      [1, 50, 22, 15, 51, 23],
      [2, 42, 14, 17, 43, 15],

      // 18
      [5, 150, 120, 1, 151, 121],
      [9, 69, 43, 4, 70, 44],
      [17, 50, 22, 1, 51, 23],
      [2, 42, 14, 19, 43, 15],

      // 19
      [3, 141, 113, 4, 142, 114],
      [3, 70, 44, 11, 71, 45],
      [17, 47, 21, 4, 48, 22],
      [9, 39, 13, 16, 40, 14],

      // 20
      [3, 135, 107, 5, 136, 108],
      [3, 67, 41, 13, 68, 42],
      [15, 54, 24, 5, 55, 25],
      [15, 43, 15, 10, 44, 16],

      // 21
      [4, 144, 116, 4, 145, 117],
      [17, 68, 42],
      [17, 50, 22, 6, 51, 23],
      [19, 46, 16, 6, 47, 17],

      // 22
      [2, 139, 111, 7, 140, 112],
      [17, 74, 46],
      [7, 54, 24, 16, 55, 25],
      [34, 37, 13],

      // 23
      [4, 151, 121, 5, 152, 122],
      [4, 75, 47, 14, 76, 48],
      [11, 54, 24, 14, 55, 25],
      [16, 45, 15, 14, 46, 16],

      // 24
      [6, 147, 117, 4, 148, 118],
      [6, 73, 45, 14, 74, 46],
      [11, 54, 24, 16, 55, 25],
      [30, 46, 16, 2, 47, 17],

      // 25
      [8, 132, 106, 4, 133, 107],
      [8, 75, 47, 13, 76, 48],
      [7, 54, 24, 22, 55, 25],
      [22, 45, 15, 13, 46, 16],

      // 26
      [10, 142, 114, 2, 143, 115],
      [19, 74, 46, 4, 75, 47],
      [28, 50, 22, 6, 51, 23],
      [33, 46, 16, 4, 47, 17],

      // 27
      [8, 152, 122, 4, 153, 123],
      [22, 73, 45, 3, 74, 46],
      [8, 53, 23, 26, 54, 24],
      [12, 45, 15, 28, 46, 16],

      // 28
      [3, 147, 117, 10, 148, 118],
      [3, 73, 45, 23, 74, 46],
      [4, 54, 24, 31, 55, 25],
      [11, 45, 15, 31, 46, 16],

      // 29
      [7, 146, 116, 7, 147, 117],
      [21, 73, 45, 7, 74, 46],
      [1, 53, 23, 37, 54, 24],
      [19, 45, 15, 26, 46, 16],

      // 30
      [5, 145, 115, 10, 146, 116],
      [19, 75, 47, 10, 76, 48],
      [15, 54, 24, 25, 55, 25],
      [23, 45, 15, 25, 46, 16],

      // 31
      [13, 145, 115, 3, 146, 116],
      [2, 74, 46, 29, 75, 47],
      [42, 54, 24, 1, 55, 25],
      [23, 45, 15, 28, 46, 16],

      // 32
      [17, 145, 115],
      [10, 74, 46, 23, 75, 47],
      [10, 54, 24, 35, 55, 25],
      [19, 45, 15, 35, 46, 16],

      // 33
      [17, 145, 115, 1, 146, 116],
      [14, 74, 46, 21, 75, 47],
      [29, 54, 24, 19, 55, 25],
      [11, 45, 15, 46, 46, 16],

      // 34
      [13, 145, 115, 6, 146, 116],
      [14, 74, 46, 23, 75, 47],
      [44, 54, 24, 7, 55, 25],
      [59, 46, 16, 1, 47, 17],

      // 35
      [12, 151, 121, 7, 152, 122],
      [12, 75, 47, 26, 76, 48],
      [39, 54, 24, 14, 55, 25],
      [22, 45, 15, 41, 46, 16],

      // 36
      [6, 151, 121, 14, 152, 122],
      [6, 75, 47, 34, 76, 48],
      [46, 54, 24, 10, 55, 25],
      [2, 45, 15, 64, 46, 16],

      // 37
      [17, 152, 122, 4, 153, 123],
      [29, 74, 46, 14, 75, 47],
      [49, 54, 24, 10, 55, 25],
      [24, 45, 15, 46, 46, 16],

      // 38
      [4, 152, 122, 18, 153, 123],
      [13, 74, 46, 32, 75, 47],
      [48, 54, 24, 14, 55, 25],
      [42, 45, 15, 32, 46, 16],

      // 39
      [20, 147, 117, 4, 148, 118],
      [40, 75, 47, 7, 76, 48],
      [43, 54, 24, 22, 55, 25],
      [10, 45, 15, 67, 46, 16],

      // 40
      [19, 148, 118, 6, 149, 119],
      [18, 75, 47, 31, 76, 48],
      [34, 54, 24, 34, 55, 25],
      [20, 45, 15, 61, 46, 16]
    ];

    var qrRSBlock = function(totalCount, dataCount) {
      var _this = {};
      _this.totalCount = totalCount;
      _this.dataCount = dataCount;
      return _this;
    };

    var _this = {};

    var getRsBlockTable = function(typeNumber, errorCorrectionLevel) {

      switch(errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default :
        return undefined;
      }
    };

    _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {

      var rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);

      if (typeof rsBlock == 'undefined') {
        throw 'bad rs block @ typeNumber:' + typeNumber +
            '/errorCorrectionLevel:' + errorCorrectionLevel;
      }

      var length = rsBlock.length / 3;

      var list = [];

      for (var i = 0; i < length; i += 1) {

        var count = rsBlock[i * 3 + 0];
        var totalCount = rsBlock[i * 3 + 1];
        var dataCount = rsBlock[i * 3 + 2];

        for (var j = 0; j < count; j += 1) {
          list.push(qrRSBlock(totalCount, dataCount) );
        }
      }

      return list;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrBitBuffer
  //---------------------------------------------------------------------

  var qrBitBuffer = function() {

    var _buffer = [];
    var _length = 0;

    var _this = {};

    _this.getBuffer = function() {
      return _buffer;
    };

    _this.getAt = function(index) {
      var bufIndex = Math.floor(index / 8);
      return ( (_buffer[bufIndex] >>> (7 - index % 8) ) & 1) == 1;
    };

    _this.put = function(num, length) {
      for (var i = 0; i < length; i += 1) {
        _this.putBit( ( (num >>> (length - i - 1) ) & 1) == 1);
      }
    };

    _this.getLengthInBits = function() {
      return _length;
    };

    _this.putBit = function(bit) {

      var bufIndex = Math.floor(_length / 8);
      if (_buffer.length <= bufIndex) {
        _buffer.push(0);
      }

      if (bit) {
        _buffer[bufIndex] |= (0x80 >>> (_length % 8) );
      }

      _length += 1;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrNumber
  //---------------------------------------------------------------------

  var qrNumber = function(data) {

    var _mode = QRMode.MODE_NUMBER;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var data = _data;

      var i = 0;

      while (i + 2 < data.length) {
        buffer.put(strToNum(data.substring(i, i + 3) ), 10);
        i += 3;
      }

      if (i < data.length) {
        if (data.length - i == 1) {
          buffer.put(strToNum(data.substring(i, i + 1) ), 4);
        } else if (data.length - i == 2) {
          buffer.put(strToNum(data.substring(i, i + 2) ), 7);
        }
      }
    };

    var strToNum = function(s) {
      var num = 0;
      for (var i = 0; i < s.length; i += 1) {
        num = num * 10 + chatToNum(s.charAt(i) );
      }
      return num;
    };

    var chatToNum = function(c) {
      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      }
      throw 'illegal char :' + c;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrAlphaNum
  //---------------------------------------------------------------------

  var qrAlphaNum = function(data) {

    var _mode = QRMode.MODE_ALPHA_NUM;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var s = _data;

      var i = 0;

      while (i + 1 < s.length) {
        buffer.put(
          getCode(s.charAt(i) ) * 45 +
          getCode(s.charAt(i + 1) ), 11);
        i += 2;
      }

      if (i < s.length) {
        buffer.put(getCode(s.charAt(i) ), 6);
      }
    };

    var getCode = function(c) {

      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      } else if ('A' <= c && c <= 'Z') {
        return c.charCodeAt(0) - 'A'.charCodeAt(0) + 10;
      } else {
        switch (c) {
        case ' ' : return 36;
        case '$' : return 37;
        case '%' : return 38;
        case '*' : return 39;
        case '+' : return 40;
        case '-' : return 41;
        case '.' : return 42;
        case '/' : return 43;
        case ':' : return 44;
        default :
          throw 'illegal char :' + c;
        }
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qr8BitByte
  //---------------------------------------------------------------------

  var qr8BitByte = function(data) {

    var _mode = QRMode.MODE_8BIT_BYTE;
    var _data = data;
    var _bytes = qrcode.stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _bytes.length;
    };

    _this.write = function(buffer) {
      for (var i = 0; i < _bytes.length; i += 1) {
        buffer.put(_bytes[i], 8);
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrKanji
  //---------------------------------------------------------------------

  var qrKanji = function(data) {

    var _mode = QRMode.MODE_KANJI;
    var _data = data;

    var stringToBytes = qrcode.stringToBytesFuncs['SJIS'];
    if (!stringToBytes) {
      throw 'sjis not supported.';
    }
    !function(c, code) {
      // self test for sjis support.
      var test = stringToBytes(c);
      if (test.length != 2 || ( (test[0] << 8) | test[1]) != code) {
        throw 'sjis not supported.';
      }
    }('\u53cb', 0x9746);

    var _bytes = stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return ~~(_bytes.length / 2);
    };

    _this.write = function(buffer) {

      var data = _bytes;

      var i = 0;

      while (i + 1 < data.length) {

        var c = ( (0xff & data[i]) << 8) | (0xff & data[i + 1]);

        if (0x8140 <= c && c <= 0x9FFC) {
          c -= 0x8140;
        } else if (0xE040 <= c && c <= 0xEBBF) {
          c -= 0xC140;
        } else {
          throw 'illegal char at ' + (i + 1) + '/' + c;
        }

        c = ( (c >>> 8) & 0xff) * 0xC0 + (c & 0xff);

        buffer.put(c, 13);

        i += 2;
      }

      if (i < data.length) {
        throw 'illegal char at ' + (i + 1);
      }
    };

    return _this;
  };

  //=====================================================================
  // GIF Support etc.
  //

  //---------------------------------------------------------------------
  // byteArrayOutputStream
  //---------------------------------------------------------------------

  var byteArrayOutputStream = function() {

    var _bytes = [];

    var _this = {};

    _this.writeByte = function(b) {
      _bytes.push(b & 0xff);
    };

    _this.writeShort = function(i) {
      _this.writeByte(i);
      _this.writeByte(i >>> 8);
    };

    _this.writeBytes = function(b, off, len) {
      off = off || 0;
      len = len || b.length;
      for (var i = 0; i < len; i += 1) {
        _this.writeByte(b[i + off]);
      }
    };

    _this.writeString = function(s) {
      for (var i = 0; i < s.length; i += 1) {
        _this.writeByte(s.charCodeAt(i) );
      }
    };

    _this.toByteArray = function() {
      return _bytes;
    };

    _this.toString = function() {
      var s = '';
      s += '[';
      for (var i = 0; i < _bytes.length; i += 1) {
        if (i > 0) {
          s += ',';
        }
        s += _bytes[i];
      }
      s += ']';
      return s;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64EncodeOutputStream
  //---------------------------------------------------------------------

  var base64EncodeOutputStream = function() {

    var _buffer = 0;
    var _buflen = 0;
    var _length = 0;
    var _base64 = '';

    var _this = {};

    var writeEncoded = function(b) {
      _base64 += String.fromCharCode(encode(b & 0x3f) );
    };

    var encode = function(n) {
      if (n < 0) {
        // error.
      } else if (n < 26) {
        return 0x41 + n;
      } else if (n < 52) {
        return 0x61 + (n - 26);
      } else if (n < 62) {
        return 0x30 + (n - 52);
      } else if (n == 62) {
        return 0x2b;
      } else if (n == 63) {
        return 0x2f;
      }
      throw 'n:' + n;
    };

    _this.writeByte = function(n) {

      _buffer = (_buffer << 8) | (n & 0xff);
      _buflen += 8;
      _length += 1;

      while (_buflen >= 6) {
        writeEncoded(_buffer >>> (_buflen - 6) );
        _buflen -= 6;
      }
    };

    _this.flush = function() {

      if (_buflen > 0) {
        writeEncoded(_buffer << (6 - _buflen) );
        _buffer = 0;
        _buflen = 0;
      }

      if (_length % 3 != 0) {
        // padding
        var padlen = 3 - _length % 3;
        for (var i = 0; i < padlen; i += 1) {
          _base64 += '=';
        }
      }
    };

    _this.toString = function() {
      return _base64;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64DecodeInputStream
  //---------------------------------------------------------------------

  var base64DecodeInputStream = function(str) {

    var _str = str;
    var _pos = 0;
    var _buffer = 0;
    var _buflen = 0;

    var _this = {};

    _this.read = function() {

      while (_buflen < 8) {

        if (_pos >= _str.length) {
          if (_buflen == 0) {
            return -1;
          }
          throw 'unexpected end of file./' + _buflen;
        }

        var c = _str.charAt(_pos);
        _pos += 1;

        if (c == '=') {
          _buflen = 0;
          return -1;
        } else if (c.match(/^\s$/) ) {
          // ignore if whitespace.
          continue;
        }

        _buffer = (_buffer << 6) | decode(c.charCodeAt(0) );
        _buflen += 6;
      }

      var n = (_buffer >>> (_buflen - 8) ) & 0xff;
      _buflen -= 8;
      return n;
    };

    var decode = function(c) {
      if (0x41 <= c && c <= 0x5a) {
        return c - 0x41;
      } else if (0x61 <= c && c <= 0x7a) {
        return c - 0x61 + 26;
      } else if (0x30 <= c && c <= 0x39) {
        return c - 0x30 + 52;
      } else if (c == 0x2b) {
        return 62;
      } else if (c == 0x2f) {
        return 63;
      } else {
        throw 'c:' + c;
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // gifImage (B/W)
  //---------------------------------------------------------------------

  var gifImage = function(width, height) {

    var _width = width;
    var _height = height;
    var _data = new Array(width * height);

    var _this = {};

    _this.setPixel = function(x, y, pixel) {
      _data[y * _width + x] = pixel;
    };

    _this.write = function(out) {

      //---------------------------------
      // GIF Signature

      out.writeString('GIF87a');

      //---------------------------------
      // Screen Descriptor

      out.writeShort(_width);
      out.writeShort(_height);

      out.writeByte(0x80); // 2bit
      out.writeByte(0);
      out.writeByte(0);

      //---------------------------------
      // Global Color Map

      // black
      out.writeByte(0x00);
      out.writeByte(0x00);
      out.writeByte(0x00);

      // white
      out.writeByte(0xff);
      out.writeByte(0xff);
      out.writeByte(0xff);

      //---------------------------------
      // Image Descriptor

      out.writeString(',');
      out.writeShort(0);
      out.writeShort(0);
      out.writeShort(_width);
      out.writeShort(_height);
      out.writeByte(0);

      //---------------------------------
      // Local Color Map

      //---------------------------------
      // Raster Data

      var lzwMinCodeSize = 2;
      var raster = getLZWRaster(lzwMinCodeSize);

      out.writeByte(lzwMinCodeSize);

      var offset = 0;

      while (raster.length - offset > 255) {
        out.writeByte(255);
        out.writeBytes(raster, offset, 255);
        offset += 255;
      }

      out.writeByte(raster.length - offset);
      out.writeBytes(raster, offset, raster.length - offset);
      out.writeByte(0x00);

      //---------------------------------
      // GIF Terminator
      out.writeString(';');
    };

    var bitOutputStream = function(out) {

      var _out = out;
      var _bitLength = 0;
      var _bitBuffer = 0;

      var _this = {};

      _this.write = function(data, length) {

        if ( (data >>> length) != 0) {
          throw 'length over';
        }

        while (_bitLength + length >= 8) {
          _out.writeByte(0xff & ( (data << _bitLength) | _bitBuffer) );
          length -= (8 - _bitLength);
          data >>>= (8 - _bitLength);
          _bitBuffer = 0;
          _bitLength = 0;
        }

        _bitBuffer = (data << _bitLength) | _bitBuffer;
        _bitLength = _bitLength + length;
      };

      _this.flush = function() {
        if (_bitLength > 0) {
          _out.writeByte(_bitBuffer);
        }
      };

      return _this;
    };

    var getLZWRaster = function(lzwMinCodeSize) {

      var clearCode = 1 << lzwMinCodeSize;
      var endCode = (1 << lzwMinCodeSize) + 1;
      var bitLength = lzwMinCodeSize + 1;

      // Setup LZWTable
      var table = lzwTable();

      for (var i = 0; i < clearCode; i += 1) {
        table.add(String.fromCharCode(i) );
      }
      table.add(String.fromCharCode(clearCode) );
      table.add(String.fromCharCode(endCode) );

      var byteOut = byteArrayOutputStream();
      var bitOut = bitOutputStream(byteOut);

      // clear code
      bitOut.write(clearCode, bitLength);

      var dataIndex = 0;

      var s = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;

      while (dataIndex < _data.length) {

        var c = String.fromCharCode(_data[dataIndex]);
        dataIndex += 1;

        if (table.contains(s + c) ) {

          s = s + c;

        } else {

          bitOut.write(table.indexOf(s), bitLength);

          if (table.size() < 0xfff) {

            if (table.size() == (1 << bitLength) ) {
              bitLength += 1;
            }

            table.add(s + c);
          }

          s = c;
        }
      }

      bitOut.write(table.indexOf(s), bitLength);

      // end code
      bitOut.write(endCode, bitLength);

      bitOut.flush();

      return byteOut.toByteArray();
    };

    var lzwTable = function() {

      var _map = {};
      var _size = 0;

      var _this = {};

      _this.add = function(key) {
        if (_this.contains(key) ) {
          throw 'dup key:' + key;
        }
        _map[key] = _size;
        _size += 1;
      };

      _this.size = function() {
        return _size;
      };

      _this.indexOf = function(key) {
        return _map[key];
      };

      _this.contains = function(key) {
        return typeof _map[key] != 'undefined';
      };

      return _this;
    };

    return _this;
  };

  var createDataURL = function(width, height, getPixel) {
    var gif = gifImage(width, height);
    for (var y = 0; y < height; y += 1) {
      for (var x = 0; x < width; x += 1) {
        gif.setPixel(x, y, getPixel(x, y) );
      }
    }

    var b = byteArrayOutputStream();
    gif.write(b);

    var base64 = base64EncodeOutputStream();
    var bytes = b.toByteArray();
    for (var i = 0; i < bytes.length; i += 1) {
      base64.writeByte(bytes[i]);
    }
    base64.flush();

    return 'data:image/gif;base64,' + base64;
  };

  //---------------------------------------------------------------------
  // returns qrcode function.

  return qrcode;
}();

// multibyte support
!function() {

  qrcode.stringToBytesFuncs['UTF-8'] = function(s) {
    // http://stackoverflow.com/questions/18729405/how-to-convert-utf8-string-to-byte-array
    function toUTF8Array(str) {
      var utf8 = [];
      for (var i=0; i < str.length; i++) {
        var charcode = str.charCodeAt(i);
        if (charcode < 0x80) utf8.push(charcode);
        else if (charcode < 0x800) {
          utf8.push(0xc0 | (charcode >> 6),
              0x80 | (charcode & 0x3f));
        }
        else if (charcode < 0xd800 || charcode >= 0xe000) {
          utf8.push(0xe0 | (charcode >> 12),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
        // surrogate pair
        else {
          i++;
          // UTF-16 encodes 0x10000-0x10FFFF by
          // subtracting 0x10000 and splitting the
          // 20 bits of 0x0-0xFFFFF into two halves
          charcode = 0x10000 + (((charcode & 0x3ff)<<10)
            | (str.charCodeAt(i) & 0x3ff));
          utf8.push(0xf0 | (charcode >>18),
              0x80 | ((charcode>>12) & 0x3f),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
      }
      return utf8;
    }
    return toUTF8Array(s);
  };

}();

(function (factory) {
  if (typeof define === 'function' && define.amd) {
      define([], factory);
  } else if (typeof exports === 'object') {
      module.exports = factory();
  }
}(function () {
    return qrcode;
}));

// ═══════════════════════════════════════════════════════════════════════
// 以上为内嵌的 qrcode-generator (MIT, Kazuhiko Arase)。
// 以下为 WeChat Diary 插件本体。文件末尾的 module.exports 覆盖上方 UMD 段的赋值。
// ═══════════════════════════════════════════════════════════════════════

const { Plugin, PluginSettingTab, Setting, Modal, Notice, normalizePath, requestUrl, Platform, AbstractInputSuggest } = require("obsidian");

const PLUGIN_VERSION = "0.1.3";
const AGENT_NAME = "obsidian-wechat-diary";
const BOT_AGENT = AGENT_NAME + "/" + PLUGIN_VERSION;
const CHANNEL_VERSION = "2.4.6";               // 对齐官方 @tencent-weixin/openclaw-weixin
const CLIENT_VERSION_HEADER = "132102";        // (2<<16)|(4<<8)|6, 版本号的 uint32 编码
const FIXED_BASE_URL = "https://ilinkai.weixin.qq.com";
const SECRET_BOT_TOKEN = "wechat-diary-ilink-bot-token";
const SECRET_AI_KEY = "wechat-diary-ai-api-key";

const LONG_POLL_TIMEOUT_MS = 35000;
const SEND_TIMEOUT_MS = 15000;
const NOTIFY_TIMEOUT_MS = 10000;
const QR_FETCH_TIMEOUT_MS = 15000;
const LOGIN_TOTAL_TIMEOUT_MS = 480000;
const QR_LOCAL_TTL_MS = 5 * 60 * 1000;         // 单张二维码本地 TTL(同官方): 服务端不一定报 expired, 到点自己换码
const STALE_TOKEN_ERRCODE = -14;
const SESSION_PAUSE_MS = 60 * 60 * 1000;       // -14 冷却整 1 小时, 同官方
const MAX_RECENT_SEQS = 200;
const NUDGE_EVERY = 4;                         // 每 4 段追加一次劝收尾
const OFFLINE_NOTICE_GAP_H = 12;

const DEFAULT_SETTINGS = {
  diaryFolder: "日记",
  timezone: "Asia/Shanghai",
  aiApiUrl: "",
  aiModel: "",
  graceMinutes: 30, // 午夜宽限期; 暂无设置 UI, 需要改的用户直接编辑插件 data.json
};

// ── 北京时间工具(019 config.py 的教训: 禁止裸用宿主机本地时间)─────────

let _tz = "Asia/Shanghai";
let _dateFmt, _timeFmt, _weekdayFmt;

function setTimezone(tz) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch (e) {
    tz = "Asia/Shanghai";
  }
  _tz = tz;
  _dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: _tz, year: "numeric", month: "2-digit", day: "2-digit" });
  _timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: _tz, hour: "2-digit", minute: "2-digit", hour12: false });
  _weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: _tz, weekday: "short" });
}
setTimezone(_tz);

function todayStr(d) { return _dateFmt.format(d || new Date()); }
function hhmmStr(d) { return _timeFmt.format(d || new Date()); }

const WEEKDAY_CN = { Mon: "一", Tue: "二", Wed: "三", Thu: "四", Fri: "五", Sat: "六", Sun: "日" };
function weekdayStr(d) { return "周" + (WEEKDAY_CN[_weekdayFmt.format(d || new Date())] || "?"); }
// 日历日期的星期与时区无关: 按 UTC 正午求值, 任何配置时区下都不会偏一天
const _weekdayFmtUTC = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" });
function weekdayForDate(dateStr) { return "周" + (WEEKDAY_CN[_weekdayFmtUTC.format(new Date(dateStr + "T12:00:00Z"))] || "?"); }
// 「昨天」不能用 now-24h 一把梭(DST 春季拨快夜只有 23 小时): 取第一个与今天不同的日期
function yesterdayStr(now) {
  const t = now || Date.now();
  const today = todayStr(new Date(t));
  for (const h of [24, 20, 28]) {
    const c = todayStr(new Date(t - h * 3600000));
    if (c !== today) return c;
  }
  return todayStr(new Date(t - 86400000));
}

function codePointLen(s) { return [...s].length; }
function randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randHex(n) {
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

// ── 文案资产(019 welcome.py 逐字搬运; 标【宿主适配】处为唯一改动)──────

const WELCOME_TEXT = `嗨~ 我是你的日记 Agent 📖

我有两种模式:
• 平时陪你随便聊聊 (闲聊模式)
• 你说「开始记日记」就进入记录模式, 之后说什么我都帮你记到今天的笔记里
• 完了发「结束」收尾归档

随时发「帮助」看完整命令。

第一次见面, 你希望我叫你什么名字呢?
(直接发名字就行, 比如「谷雨」; 也可以说「叫我XX」; 不想要称呼就发「跳过」)`;

const NAME_CONFIRM_TEMPLATE = "好的{name}~ 以后我们一起记日记吧 😊\n想说什么直接发, 或发「开始记日记」开始今天的记录";
const NAME_UNCLEAR_HINT = "没太看出来名字呢~ 名字短一点直接发就行, 比如「谷雨」, 再发一次? 不想要称呼就发「跳过」";
const STILL_AWAITING_NAME_HINT = "(对了, 还没告诉我怎么称呼你呢~ 直接发名字就行, 比如「谷雨」; 不想要就发「跳过」)";
const NAME_SKIPPED_REPLY = "好的~ 那就不特别称呼啦 😊 想记今天的话, 发「开始记日记」就开始; 以后想让我称呼你, 随时发「叫我XX」";
const NAME_LATER_HINT = "(名字不急~ 记完发「结束」之后, 随时发「叫我XX」告诉我就行)";
const NAME_INLINE_CONFIRM_TEMPLATE = "(称呼记下啦, {name}~)";
const RENAME_CONFIRM_TEMPLATE = "好嘞{name}~ 以后就这么叫你啦 😊";
const NAME_MAX_LEN = 10;

// 【宿主适配】末两行: 插件 v0.1 无定时提醒; 跨天行为按宽限期修复后的实际行为描述
const HELP_TEXT = `📖 日记 Agent 使用指南

【两种模式】
• 闲聊模式 (默认): 随便聊, 不写日记
• 记录模式: 你说的话都会写进今天的笔记

【模式切换】
• 进入记录: 发「开始记日记」/「记日记」/「开始」
• 退出记录: 发「结束」(同时归档今天)

【命令 (两种模式都能用)】
• 帮助 → 看到这条
• 撤回 → 删掉刚才记的最后一段 (仅记录模式)
• 叫我XX → 设置/修改你的称呼 (闲聊模式下)

跨天会自动回到闲聊模式 (避免新一天的话被记到昨天);
深夜写着写着过了零点也不怕, 半小时内继续说仍算前一晚。`;

const ENTER_DIARY_REPLIES = [
  "好的~ 开始记今天的日记 📖 想说什么直接说就行, 完了发「结束」收尾",
  "记录模式开启 ✍️ 接下来你说的都会写进今天的笔记",
  "好嘞, 我洗耳恭听 📖 完了记得说「结束」让我归档",
];

const CHAT_COST_REMINDER = "\n\n💡 闲聊会消耗一点 token~ 我主要是帮你记日记的, 想记今天的话发「开始记日记」就开始 📖";

const NOT_IN_DIARY_HINTS = {
  undo: "现在是闲聊模式哦, 还没开始记呢, 没东西可撤~ 想记的话发「开始记日记」",
  finalize: "现在是闲聊模式, 还没开始记呢~ 想记的话发「开始记日记」",
};

const CLOSING_LINES = [
  "今天的故事我收好啦, 晚安 ✨",
  "已经装订成册 📖",
  "归档完毕, 这一页属于今天了。",
  "小册子合上了, 安心睡吧。",
  "好了, 今天的心事都在本子里了。",
  "日记本盖章 📮 愿今晚好梦。",
  "收进时光胶囊, 明年今日再开。",
  "今天的字, 都存好了, 晚安。",
  "咔哒, 打卡完成 ✓ 今天辛苦了。",
  "一天的褶皱, 已经熨平收好。",
];
const CLOSING_FAREWELL_LINES = ["明天见 👋", "明天再聊~", "好梦, 明天见 🌙", "明天我等你 📖", "明天再见呀 ✨"];
const CLOSING_LINES_WITH_NAME = [
  "辛苦啦{name}~ 今天又记下了一些珍贵的东西 🌙",
  "{name}, 今天的故事我收好啦, 晚安 ✨",
  "{name}, 这一页属于今天, 收好了 📖",
];

const NUDGE_TEXT = "差不多了? 还有吗? 没有就发「结束」, 我帮你收进今天的小册子。";

const CHAT_GREETING_REPLIES = [
  "嗨~ 我在呢 😊 想说点什么?",
  "在的在的, 今天过得怎么样?",
  "嗨~ 来啦? 想到什么直接说就好",
  "我在呢, 慢慢说我都听着",
  "嗨~ 准备好开聊了吗?",
];

// 【宿主适配】第三条: .env 概念改为插件设置面板
const NO_KEY_CHAT_REPLIES = [
  "我在呢~ 不过我的主业是帮你记日记 📖 发「开始记日记」就开始",
  "嗯嗯我听着~ 想记下来的话, 发「开始记日记」就好",
  "我在~ 陪聊需要在插件设置里配好 AI 接口才能开启; 记日记不用, 发「开始记日记」就行",
];

const UNDO_OK_REPLY = "好的, 帮你撤回啦";
const UNDO_EMPTY_REPLY = "今天还什么都没说呢, 没东西可撤哦";
const FINALIZE_EMPTY_REPLY = "今天还没说话呢, 要不先说两句吧?";
// 020 新文案: 宽限期外跨天, 昨天已自动封存的告知(019 无此文案, 修「午夜割裂静默吃话」)
const GRACE_EXPIRED_NOTICE = "(对了, 昨天的记录我帮你封存好啦~ 新的一天想记的话, 发「开始记日记」重新开始)";

function randomClosing(name) {
  let head;
  if (name && Math.random() < 0.3) head = randomChoice(CLOSING_LINES_WITH_NAME).split("{name}").join(name);
  else head = randomChoice(CLOSING_LINES);
  return head + "\n\n" + randomChoice(CLOSING_FAREWELL_LINES);
}

// ── 意图识别(019 intents.py 移植 + 020「误切换吃内容」修复)──────────────

const INTENT = { DIARY: "DIARY", FINALIZE: "FINALIZE", UNDO: "UNDO", HELP: "HELP", CHAT: "CHAT", START_DIARY: "START_DIARY" };

const MAX_COMMAND_LEN = 15;
const FINALIZE_KEYWORDS = new Set(["结束", "收尾", "收工", "打烊", "归档", "完了"]);
const UNDO_KEYWORDS = new Set(["撤回", "删掉", "删除", "撤销", "删掉上一段", "删掉上条", "撤回上一段"]);
const HELP_KEYWORDS = new Set(["/help", "help", "帮助", "怎么用", "使用说明", "菜单"]);
const CHAT_GREETING_KEYWORDS = new Set([
  "你好", "您好", "嗨", "hi", "hello", "hihi", "halo",
  "在吗", "在么", "在不在", "在嘛", "喂",
  "我来啦", "我来了", "来啦", "我来",
  "早", "早安", "早上好", "中午好", "下午好", "晚上好",
]);
const START_DIARY_KEYWORDS = new Set([
  "开始记日记", "开始记录", "记日记", "开始", "开始写",
  "我要记日记", "我要写日记", "我要记录",
  "可以记日记吗", "可以开始吗", "记一下",
]);
// 故意不含单字「开始」, 避免「今天工作开始得很早」误触发
const START_DIARY_PHRASES = ["开始记日记", "开始记录", "开始写日记", "我们记日记"];

const STRIP_CHARS = new Set([..."。!?!?,,、~ \t\n　"]);
const TAIL_PARTICLES = ["吧", "啊", "啦", "呀", "哦", "嘛", "呗", "哈"];

function rstripChars(s, charSet) {
  const arr = [...s];
  let end = arr.length;
  while (end > 0 && charSet.has(arr[end - 1])) end--;
  return arr.slice(0, end).join("");
}

function normalizeIntent(text) {
  let s = (text || "").trim().split("　").join(" ");
  s = rstripChars(s, STRIP_CHARS).trimStart().toLowerCase();
  // 循环剥尾部语气词: 语气词后可能还有标点(「开始记日记吧。」)
  for (;;) {
    let changed = false;
    for (const p of TAIL_PARTICLES) {
      if (s.length > p.length && s.endsWith(p)) { s = s.slice(0, s.length - p.length); changed = true; break; }
    }
    s = rstripChars(s, STRIP_CHARS);
    if (!changed) break;
  }
  return s;
}

// 返回 { intent, suspect }。suspect=true 表示长句中出现开始短语(020 修复:
// 019 会把「从下个月开始记录我的开销」整句当切换指令且丢句; 020 切换同时把原句写入)。
function detectIntent(text) {
  const raw = (text || "").trim();
  if (!raw) return { intent: INTENT.DIARY };
  const norm = normalizeIntent(raw);
  const cp = codePointLen(raw);
  if (START_DIARY_PHRASES.some((p) => raw.includes(p))) {
    if (cp <= MAX_COMMAND_LEN || START_DIARY_KEYWORDS.has(norm)) return { intent: INTENT.START_DIARY };
    return { intent: INTENT.START_DIARY, suspect: true };
  }
  if (cp > MAX_COMMAND_LEN) return { intent: INTENT.DIARY };
  if (FINALIZE_KEYWORDS.has(norm)) return { intent: INTENT.FINALIZE };
  if (UNDO_KEYWORDS.has(norm)) return { intent: INTENT.UNDO };
  // 语音转写「撤回撤回撤回这一段」兜底; 只放行这两个前缀(「删掉了一些旧照片」是日记)
  if (norm.startsWith("撤回") || norm.startsWith("撤销")) return { intent: INTENT.UNDO };
  if (HELP_KEYWORDS.has(norm)) return { intent: INTENT.HELP };
  if (START_DIARY_KEYWORDS.has(norm)) return { intent: INTENT.START_DIARY };
  if (CHAT_GREETING_KEYWORDS.has(norm)) return { intent: INTENT.CHAT };
  return { intent: INTENT.DIARY };
}

// ── 取名规则引擎(019 names.py 移植)─────────────────────────────────────

const CALL_ME_MARKERS = ["叫我", "喊我", "称呼我", "称我"];
const NEG_TOKENS = ["别", "不", "没", "勿", "咋", "怎么", "如何", "怎样"];
const CLAUSE_SPLIT_RE = /[。．.!!??,,;;、\n]/;
const REFUSALS = new Set([
  "不用", "不用了", "不需要", "不必", "随便", "随意", "都行", "都可以",
  "无所谓", "算了", "跳过", "不想说", "保密", "没有", "不告诉你",
  "你随便", "随便你", "你定", "你看着办", "不取了", "不用取",
]);
const REFUSAL_PREFIXES = [
  "不用", "不要", "不需要", "不必", "不想", "不取", "不了", "免了", "算了",
  "随便", "随意", "无所谓", "都行", "都可以", "跳过", "保密", "没有名字",
  "不告诉", "你随便", "你定", "你看着办",
];
const REFUSAL_HINTS = ["什么都行", "什么都可以", "无所谓", "随便"];
const INTERROGATIVES = ["什么", "啥", "谁", "怎么", "为什么", "哪", "如何", "几点"];
const QUESTION_SUFFIXES = ["干嘛", "干什么", "干啥", "做什么", "做甚"];
const NON_NAMES = new Set([
  "好", "好的", "好呀", "好啊", "行", "可以", "嗯", "嗯嗯", "哦", "噢", "喔",
  "是", "对", "什么", "啥", "为什么", "怎么", "怎么办", "谢谢", "多谢",
  "干", "干嘛", "干什么", "干啥", "名字", "什么名字", "比较好",
  "起床", "吃饭", "睡觉", "上班", "下班", "开会", "加班", "帮忙",
  "说两句", "说话", "想想", "看看", "加油",
]);
const RENAME_PREFIXES = new Set([
  "", "请", "就", "你", "您", "你就", "您就", "那就", "以后", "以后就",
  "以后请", "以后你就", "改成", "改口", "还是", "重新",
]);
const NAME_LEAD_PHRASES = ["那就叫", "就叫我", "就叫", "那就", "就", "那", "嗯", "呃", "唔"];
const NAME_TAIL_COURTESY = [
  "就可以了", "就行了", "就好了", "就可以", "就行", "就好", "就成", "好了",
  "怎么样", "可以吗", "行不行", "好不好", "都可以", "行吗", "好吗", "都行", "如何",
];
const NAME_TAIL_PARTICLES = new Set([..."吧呗啦哟哦呀嘛呢咯喽吗么嗯"]);
const NAME_FUNCTION_CHARS = [..."的了是在去到给帮"];

function cleanName(s) {
  return rstripChars((s || "").trim(), STRIP_CHARS).trim();
}

function validateName(candidate) {
  let s = (candidate || "").trim();
  if (!s) return null;
  // 取到第一个分句标点为止
  s = s.split(CLAUSE_SPLIT_RE)[0].trim();
  if (!s) return null;
  // 反问后缀与疑问词必须在剥语气词之前判(「什么都行」剥「么」会逃检)
  if (QUESTION_SUFFIXES.some((q) => s.endsWith(q))) return null;
  if (INTERROGATIVES.some((q) => s.includes(q))) return null;
  // 剥头部引导短语(长在前)
  for (;;) {
    const hit = NAME_LEAD_PHRASES.find((p) => s.length > p.length && s.startsWith(p));
    if (!hit) break;
    s = s.slice(hit.length).trim();
  }
  // 剥尾部客套(长在前)
  for (;;) {
    const hit = NAME_TAIL_COURTESY.find((p) => s.length > p.length && s.endsWith(p));
    if (!hit) break;
    s = s.slice(0, s.length - hit.length).trim();
  }
  // 剥尾部语气词, 剥后必须还有内容(保护「小哈」这类名字)
  for (;;) {
    const arr = [...s];
    if (arr.length > 1 && NAME_TAIL_PARTICLES.has(arr[arr.length - 1])) s = arr.slice(0, -1).join("");
    else break;
  }
  s = s.trim();
  const n = codePointLen(s);
  if (n < 1 || n > NAME_MAX_LEN) return null;
  if (NON_NAMES.has(s) || REFUSALS.has(s)) return null;
  // 命令词/招呼词(帮助/结束/开始/你好...)不能当名字
  if (detectIntent(s).intent !== INTENT.DIARY) return null;
  return s;
}

function isRefusal(text) {
  const cleaned = cleanName(text);
  if (REFUSALS.has(cleaned) || REFUSALS.has(normalizeIntent(cleaned))) return true;
  const firstClause = cleanName((text || "").trim().split(CLAUSE_SPLIT_RE)[0]);
  return REFUSAL_PREFIXES.some((p) => cleaned.startsWith(p) || firstClause.startsWith(p));
}

// 整句复读折叠(语音转写「就叫谷雨吧就叫谷雨吧」); 单元长度≥2, 叠字昵称不折叠
function foldRepeats(text) {
  const arr = [...text];
  const n = arr.length;
  for (let u = 2; u <= Math.floor(n / 2); u++) {
    if (n % u !== 0) continue;
    const unit = arr.slice(0, u).join("");
    if (unit.repeat(n / u) === text) return unit;
  }
  return text;
}

function lastMarkerHit(text) {
  let best = null;
  for (const marker of CALL_ME_MARKERS) {
    let idx = text.lastIndexOf(marker);
    if (idx >= 0 && (best === null || idx > best.idx)) best = { idx, marker };
  }
  return best;
}

// 取名回答提取。返回 { name, refused }。
function extractName(text) {
  text = (text || "").trim();
  if (!text) return { name: null, refused: false };
  // 1. 「叫我X」显式句式优先(保证「随便叫我小谷吧」是取名不是拒绝)
  const hit = lastMarkerHit(text);
  if (hit) {
    const windowStart = Math.max(0, hit.idx - 2);
    const win = text.slice(windowStart, hit.idx);
    const negated = NEG_TOKENS.some((t) => win.includes(t));
    if (!negated) {
      const name = validateName(text.slice(hit.idx + hit.marker.length));
      if (name) return { name, refused: false };
      if (REFUSAL_HINTS.some((h) => text.includes(h))) return { name: null, refused: true };
      return { name: null, refused: false }; // 有标记无名字: 不做裸兜底, 避免整句当名字
    }
  }
  // 2. 拒绝
  if (isRefusal(text)) return { name: null, refused: true };
  // 3. 「我叫X」自我介绍
  const m = text.match(/^我(?:的名字|的名)?(?:是|叫做|叫)\s*(.+)$/);
  if (m) {
    const name = validateName(m[1]);
    if (name) return { name, refused: false };
  }
  // 4. 裸名字兜底: 先折叠复读, 再走 validate
  const name = validateName(foldRepeats(cleanName(text)));
  return { name, refused: false };
}

// chat 模式改名(严得多: 误改名代价 > 漏识别)
function extractExplicitName(text) {
  text = (text || "").trim();
  if (!text || codePointLen(text) > 15) return null;
  const hit = lastMarkerHit(text);
  if (!hit) return null;
  const prefix = cleanName(text.slice(0, hit.idx));
  if (!RENAME_PREFIXES.has(prefix)) return null;
  const candidate = text.slice(hit.idx + hit.marker.length);
  const cleaned = cleanName(candidate);
  if (NAME_FUNCTION_CHARS.some((c) => [...cleaned].includes(c))) return null; // 是句子不是名字
  return validateName(candidate);
}

// ── AI 调用(OpenAI 兼容; 走 requestUrl, 与 iLink 直连策略相反, 代理友好)──

const POLISH_PROMPT = `你是日记助理。用户刚说了一段话(可能是语音转写,有口语痕迹)。
请轻度润色:去掉"嗯""那个""这个"这类语气词,理顺断句;需要分行时用单个换行,不要留空行。
禁止:改变第一人称、改写语义、加入用户没说的内容、做总结或点评。
保留用户的表达风格和情绪。

用户原话:
{raw_text}

直接输出润色后的文本,不要任何前缀说明。`;

const CHAT_SYSTEM_PROMPT = `你是日记 Agent 在闲聊模式下的助手。用户当前不在记录日记的状态, 你陪用户随便聊聊。

关键约束:
- 每次回复短小 (≤50 字), 像朋友闲聊
- 不主动写日记, 因为你不在记录模式
- 当用户明显在描述今天发生的事时, 柔和提醒: "想记下来吗? 发『开始记日记』就开始"
- 保持温暖陪伴语气, 不长篇大论
- 不评判, 不给建议, 不点评

绝对禁止 (违反会欺骗用户造成混淆):
- 你没有切换模式的能力, 切换由代码层面自动处理, 不归你管
- 绝不要说"已切换到日记模式"、"现在是日记模式"、"切换回闲聊模式"、"咱们继续日记模式"等任何宣称模式状态的表达
- 用户问你现在是什么模式时, 老实回"我这边只是闲聊, 想记日记发『开始记日记』就开始"
- 想引导用户切换时只能说: "想记的话发『开始记日记』就开始 📖", 绝不冒充"已经切了"

不要做的:
- 不要装专家
- 不要总结、点评
- 不要超过 2 句话`;

const CHAT_FALLBACK_REPLIES = ["嗯~ 我在听呢", "好的, 慢慢说", "嗯嗯", "在的, 继续说", "我都听着"];

const NAME_LLM_PROMPT = `用户被问「你希望我叫你什么名字」, 用户回答:
{reply}

从回答中提取用户希望被称呼的名字, 只输出名字本身 (不超过 10 个字), 不要任何解释。
如果回答里没有名字、或用户表示不想要称呼, 只输出一个字: 无`;

// 【宿主适配】auth 一条: .env 概念改为插件设置
const NET_NOTE_BY_KIND = {
  auth: " (AI Key 好像不对呢, 检查下插件设置, 原文已存)",
  balance: " (AI 余额用完啦, 充值后试试, 原文已存)",
  rate_limit: " (AI 调用太频繁, 原文已存)",
  network: " (AI 暂时不通, 原文已存)",
  server: " (AI 服务异常, 原文已存)",
  other: " (AI 出了点小问题, 原文已存)",
  no_key: " (没配 AI Key, 原文已存)",
};

class AiClient {
  constructor(plugin) { this.plugin = plugin; }

  ready() {
    const s = this.plugin.settings;
    return Boolean(s.aiApiUrl && s.aiModel && this.plugin.getAiKey());
  }

  // 返回 content 字符串; 失败抛 {kind, message}
  async chatCompletion(messages, temperature, timeoutMs) {
    const s = this.plugin.settings;
    const key = this.plugin.getAiKey();
    if (!this.ready()) { const e = new Error("no_key"); e.kind = "no_key"; throw e; }
    const call = requestUrl({
      url: s.aiApiUrl,
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({ model: s.aiModel, messages, temperature, stream: false }),
      throw: false,
    });
    let res;
    try {
      res = await Promise.race([
        call,
        new Promise((_, rej) => window.setTimeout(() => { const e = new Error("timeout"); e.kind = "network"; rej(e); }, timeoutMs || 30000)),
      ]);
    } catch (err) {
      const e = new Error(String(err && err.message || err)); e.kind = err.kind || "network"; throw e;
    }
    const status = res.status;
    if (status < 200 || status >= 300) {
      const e = new Error("HTTP " + status);
      e.kind = status === 401 ? "auth" : status === 402 ? "balance" : status === 429 ? "rate_limit" : status >= 500 ? "server" : "other";
      throw e;
    }
    let data;
    try { data = res.json; } catch (err) { const e = new Error("bad json"); e.kind = "other"; throw e; }
    try {
      return String(data.choices[0].message.content || "").trim();
    } catch (err) { const e = new Error("bad shape"); e.kind = "other"; throw e; }
  }

  // 润色。返回 { text, usedLlm, kind } —— 零 key 是正常形态不是错误。
  async polish(rawText) {
    rawText = (rawText || "").trim();
    if (!rawText) return { text: rawText, usedLlm: false, kind: null };
    if (!this.ready()) return { text: rawText, usedLlm: false, kind: null };
    try {
      const out = await this.chatCompletion(
        [{ role: "user", content: POLISH_PROMPT.split("{raw_text}").join(rawText) }], 0.3, 15000);
      if (out) return { text: out, usedLlm: true, kind: null };
      return { text: rawText, usedLlm: false, kind: "other" };
    } catch (e) {
      return { text: rawText, usedLlm: false, kind: e.kind || "other" };
    }
  }

  async llmExtractName(reply) {
    if (!this.ready()) return null;
    try {
      const out = await this.chatCompletion(
        [{ role: "user", content: NAME_LLM_PROMPT.split("{reply}").join(reply) }], 0.3, 10000);
      if (!out || out === "无" || out.toLowerCase() === "none") return null;
      return validateName(out);
    } catch (e) { return null; }
  }
}

// 闲聊(带 5 轮内存历史, 不持久化)
class ChatHandler {
  constructor(ai) { this.ai = ai; this.history = []; }
  resetHistory() { this.history = []; }
  async chat(text) {
    if (!this.ai.ready()) return randomChoice(NO_KEY_CHAT_REPLIES);
    const messages = [{ role: "system", content: CHAT_SYSTEM_PROMPT }, ...this.history, { role: "user", content: text }];
    let reply;
    try {
      reply = await this.ai.chatCompletion(messages, 0.7, 15000);
      if (!reply) reply = randomChoice(CHAT_FALLBACK_REPLIES);
    } catch (e) {
      reply = randomChoice(CHAT_FALLBACK_REPLIES);
    }
    this.history.push({ role: "user", content: text }, { role: "assistant", content: reply });
    while (this.history.length > 10) this.history.shift();
    return reply;
  }
}

// ── 日记写入(019 diary_writer.py 移植, 产出字节级一致; 宿主换成 vault API)─

const HEADER_RE_G = /\*\*(\d{1,2}:\d{2})\*\*/g;
const HEADER_FULL_RE = /^\*\*\d{1,2}:\d{2}\*\*$/;
const NORMALIZE_BLANK_RE = /\n\s*\n+/g;
const CLOSING_MARKER = "_(今日封存于";

function lastHeaderTime(content) {
  let last = null;
  for (const m of content.matchAll(HEADER_RE_G)) last = m[1];
  return last;
}

function isMessageBlock(stripped) {
  if (!stripped) return false;
  if (stripped.startsWith("# ")) return false;
  if (HEADER_FULL_RE.test(stripped)) return false;
  if (stripped.startsWith("---")) return false;
  if (stripped.startsWith("_(")) return false;
  return true;
}

function countMessages(content) {
  return content.split("\n\n").filter((b) => isMessageBlock(b.trim())).length;
}

class DiaryWriter {
  constructor(plugin, ai) { this.plugin = plugin; this.ai = ai; }

  diaryPath(dateStr) {
    const folder = normalizePath(this.plugin.settings.diaryFolder || "日记");
    return normalizePath(folder + "/" + dateStr.slice(0, 4) + "/" + dateStr + ".md");
  }

  async _ensureParents(path) {
    const vault = this.plugin.app.vault;
    const parts = path.split("/").slice(0, -1);
    let cur = "";
    for (const p of parts) {
      cur = cur ? cur + "/" + p : p;
      if (!vault.getFolderByPath(cur)) await vault.createFolder(cur).catch(() => {});
    }
  }

  // 读-改-写。文件存在走 vault.process(原子); 不存在则 create, TOCTOU 输了转 process。
  // 返回最终全文。
  async _transform(path, fn) {
    const vault = this.plugin.app.vault;
    let file = vault.getFileByPath(path);
    if (file) return vault.process(file, fn);
    await this._ensureParents(path);
    const initial = fn("");
    try {
      await vault.create(path, initial);
      return initial;
    } catch (e) {
      file = vault.getFileByPath(path);
      if (!file) throw e;
      return vault.process(file, fn);
    }
  }

  // 写一条。返回 { reply, n }。永不抛。
  async write(text, isVoice, dateStr) {
    text = (text || "").trim();
    if (!text) return { reply: "嗯? 没听清, 再说一次?", n: 0 };
    const day = dateStr || todayStr();

    const { text: polishedRaw, usedLlm, kind } = await this.ai.polish(text);
    // 契约规则 6: 块内空行收敛为单个换行, 一次发送 = 一个块 = 一条消息
    let polished = polishedRaw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(NORMALIZE_BLANK_RE, "\n").trim();
    if (isVoice) polished = "🎤 " + polished;
    else if (polished.startsWith("# ") || polished.startsWith("---") || polished.startsWith("_(")) {
      // 首行撞契约排除前缀会让整块"隐形"(不计数、undo 误删更早内容), 反斜杠转义
      polished = "\\" + polished;
    }
    const timestamp = hhmmStr();

    let finalContent;
    try {
      const path = this.diaryPath(day);
      finalContent = await this._transform(path, (existing) => {
        if (existing) {
          const block = lastHeaderTime(existing) === timestamp
            ? "\n" + polished + "\n"
            : "\n\n**" + timestamp + "**\n\n" + polished + "\n";
          return existing + block;
        }
        const header = "---\n" +
          "date: " + day + "\n" +
          "weekday: " + weekdayForDate(day) + "\n" +
          "source: wechat-diary\n" +
          "---\n\n" +
          "# " + day + "\n";
        return header + "\n\n**" + timestamp + "**\n\n" + polished + "\n";
      });
    } catch (e) {
      console.error("[wechat-diary] 写日记失败:", e);
      // 【宿主适配】019 原文提的是「DIARY_DIR 所在盘」, 插件没有这个概念
      if (String(e && e.message).includes("ENOSPC")) return { reply: "存日记失败! 磁盘可能满了 💾 请检查磁盘空间", n: 0 };
      return { reply: "收到啦, 但写入时出了点问题, 等会儿再试试?", n: 0 };
    }

    const n = countMessages(finalContent);
    const voiceMark = isVoice ? "🎤 " : "";
    const netNote = usedLlm ? "" : (kind == null ? "" : (NET_NOTE_BY_KIND[kind] || NET_NOTE_BY_KIND.other));
    const reply = voiceMark + "嗯, 记下来啦~ 这是今天第 " + n + " 段 ✍️" + netNote +
      "\n继续说; 记错了发「撤回」, 说完了发「结束」";
    return { reply, n };
  }

  // 撤回最后一条消息; 孤儿段头一并清理。返回是否删了东西。
  async undoLastBlock(dateStr) {
    const path = this.diaryPath(dateStr || todayStr());
    const vault = this.plugin.app.vault;
    const file = vault.getFileByPath(path);
    if (!file) return false;
    let ok = false;
    try {
      await vault.process(file, (content) => {
        const parts = content.split("\n\n");
        let lastMsgI = -1;
        for (let i = parts.length - 1; i >= 0; i--) {
          if (isMessageBlock(parts[i].trim())) { lastMsgI = i; break; }
        }
        if (lastMsgI < 0) return content;
        const newParts = parts.slice(0, lastMsgI);
        while (newParts.length) {
          const tail = newParts[newParts.length - 1].trim();
          if (!tail || HEADER_FULL_RE.test(tail)) newParts.pop();
          else break;
        }
        let out = newParts.join("\n\n");
        if (out && !out.endsWith("\n")) out += "\n";
        ok = true;
        return out;
      });
    } catch (e) {
      console.error("[wechat-diary] 撤回失败:", e);
      return false;
    }
    return ok;
  }

  // 封存。空文件 false; 已封存 true(幂等)。
  async finalizeDay(dateStr) {
    const path = this.diaryPath(dateStr || todayStr());
    const vault = this.plugin.app.vault;
    const file = vault.getFileByPath(path);
    if (!file) return false;
    let ok = false;
    try {
      await vault.process(file, (content) => {
        if (!content.trim()) return content;
        ok = true;
        if (content.includes(CLOSING_MARKER)) return content;
        return content + "\n\n---\n" + CLOSING_MARKER + " " + hhmmStr() + ")_\n";
      });
    } catch (e) {
      console.error("[wechat-diary] 封存失败:", e);
      return false;
    }
    return ok;
  }
}

// ── iLink 协议客户端(对齐官方 openclaw-weixin 2.4.6; Node https 直连)────

function getHttps() {
  if (!Platform.isDesktop) throw new Error("WeChat Diary 仅支持桌面端");
  return require("https");
}

function respCode(o) {
  if (!o || typeof o !== "object") return 0;
  if (typeof o.ret === "number" && o.ret !== 0) return o.ret;
  if (typeof o.errcode === "number" && o.errcode !== 0) return o.errcode;
  return 0;
}

class ILinkClient {
  constructor() {
    const https = getHttps();
    // keepAlive 复用连接: 35s 一轮、全天几千轮, 省 TLS 握手
    this._agent = new https.Agent({ keepAlive: true, maxSockets: 2 });
    this._inflight = new Set();
    this.token = "";
    this.baseUrl = "";
  }

  destroyAll() {
    for (const req of this._inflight) { try { req.destroy(); } catch (e) { /* 已关闭 */ } }
    this._inflight.clear();
    try { this._agent.destroy(); } catch (e) { /* noop */ }
  }

  _commonHeaders() {
    return { "iLink-App-Id": "bot", "iLink-App-ClientVersion": CLIENT_VERSION_HEADER };
  }

  _postHeaders(bodyBuf) {
    const headers = Object.assign(this._commonHeaders(), {
      "Content-Type": "application/json",
      // 官方无条件发 AuthorizationType, 哪怕还没有 token
      "AuthorizationType": "ilink_bot_token",
      // 每请求重新随机, 不参与鉴权, 勿试图稳定它
      "X-WECHAT-UIN": btoa(String(Math.floor(Math.random() * 0xffffffff) >>> 0)),
      // Node 核心 http 不自动算请求 Content-Length; 019(urllib)与官方(undici)线上流量
      // 都带 CL, 服务端未验证过 chunked, 故这里按 Buffer 字节数显式给出
      "Content-Length": String(bodyBuf.length),
    });
    if (this.token && this.token.trim()) headers["Authorization"] = "Bearer " + this.token;
    return headers;
  }

  // 通用请求。resolve { status, json } 或 { __timeout: true }; 网络错误 reject。
  _raw(base, endpoint, { method, bodyObj, timeoutMs }) {
    const https = getHttps();
    const url = new URL(endpoint, base.endsWith("/") ? base : base + "/");
    const isPost = method === "POST";
    const bodyBuf = isPost ? Buffer.from(JSON.stringify(bodyObj || {}), "utf8") : null;
    const headers = isPost ? this._postHeaders(bodyBuf) : this._commonHeaders();
    return new Promise((resolve, reject) => {
      let settled = false;
      let timedOut = false;
      const done = (fn, v) => { if (!settled) { settled = true; window.clearTimeout(timer); this._inflight.delete(req); fn(v); } };
      const req = https.request(url, { method, headers, agent: this._agent }, (res) => {
        res.setEncoding("utf8");
        let raw = "";
        res.on("data", (d) => { raw += d; });
        res.on("aborted", () => { timedOut ? done(resolve, { __timeout: true }) : done(reject, new Error("aborted")); });
        res.on("end", () => {
          // 官方对 !res.ok 一律 throw; 网关 5xx 的 JSON 体不能当业务成功
          if (res.statusCode < 200 || res.statusCode >= 300) {
            done(reject, new Error("HTTP " + res.statusCode + ": " + raw.slice(0, 120)));
            return;
          }
          let json = null;
          try { json = JSON.parse(raw); } catch (e) { /* 非 JSON, 保留 null */ }
          if (json === null) {
            done(reject, new Error("HTTP " + res.statusCode + " 非 JSON 响应: " + raw.slice(0, 120)));
            return;
          }
          done(resolve, { status: res.statusCode, json });
        });
      });
      this._inflight.add(req);
      const timer = window.setTimeout(() => { timedOut = true; try { req.destroy(new Error("ilink-timeout")); } catch (e) { /* noop */ } }, timeoutMs);
      req.on("error", (err) => { timedOut ? done(resolve, { __timeout: true }) : done(reject, err); });
      if (bodyBuf) req.end(bodyBuf); else req.end();
    });
  }

  _baseInfo() { return { channel_version: CHANNEL_VERSION, bot_agent: BOT_AGENT }; }

  // 取二维码永远打固定域名(即使重登录)。localTokens: 本机已有 token 列表。
  async getQrcode(localTokens) {
    const r = await this._raw(FIXED_BASE_URL, "ilink/bot/get_bot_qrcode?bot_type=3", {
      method: "POST",
      bodyObj: { local_token_list: localTokens || [], base_info: this._baseInfo() },
      timeoutMs: QR_FETCH_TIMEOUT_MS,
    });
    if (r.__timeout) throw new Error("取二维码超时");
    const code = respCode(r.json);
    if (code !== 0) throw new Error("取二维码失败 ret=" + code + " " + (r.json.errmsg || ""));
    return { qrcode: r.json.qrcode, qrPageUrl: r.json.qrcode_img_content };
  }

  // 轮询一次扫码状态。GET 只带通用头。pollBase 可被 scaned_but_redirect 换掉。
  async pollQrStatus(pollBase, qrcode, verifyCode) {
    let ep = "ilink/bot/get_qrcode_status?qrcode=" + encodeURIComponent(qrcode);
    if (verifyCode) ep += "&verify_code=" + encodeURIComponent(verifyCode);
    return this._raw(pollBase, ep, { method: "GET", timeoutMs: LONG_POLL_TIMEOUT_MS });
  }

  apiBase() { return this.baseUrl || FIXED_BASE_URL; }

  async getUpdates(buf, timeoutMs) {
    return this._raw(this.apiBase(), "ilink/bot/getupdates", {
      method: "POST",
      bodyObj: { get_updates_buf: buf || "", base_info: this._baseInfo() },
      timeoutMs: timeoutMs || LONG_POLL_TIMEOUT_MS,
    });
  }

  // 发文本。contextToken 没有就省略字段(官方: warn 后照发, 绝不做本地新鲜度预判)。
  async sendText(toUserId, text, contextToken) {
    const chunks = [];
    const arr = [...(text || "")];
    for (let i = 0; i < arr.length; i += 4000) chunks.push(arr.slice(i, i + 4000).join(""));
    for (const chunk of chunks) {
      if (!chunk) continue;
      const msg = {
        from_user_id: "",
        to_user_id: toUserId,
        client_id: AGENT_NAME + ":" + Date.now() + "-" + randHex(8),
        message_type: 2,   // BOT
        message_state: 2,  // FINISH
        item_list: [{ type: 1, text_item: { text: chunk } }],
      };
      if (contextToken) msg.context_token = contextToken;
      const r = await this._raw(this.apiBase(), "ilink/bot/sendmessage", {
        method: "POST",
        bodyObj: { msg, base_info: this._baseInfo() },
        timeoutMs: SEND_TIMEOUT_MS,
      });
      if (r.__timeout) throw new Error("发送超时");
      const code = respCode(r.json);
      if (code !== 0) { const e = new Error("发送失败 ret=" + code); e.ilinkCode = code; throw e; }
    }
    return true;
  }

  // 上下线通知: 失败只记日志, 不阻塞(同官方)
  notify(which) {
    this._raw(this.apiBase(), "ilink/bot/msg/" + which, {
      method: "POST", bodyObj: { base_info: this._baseInfo() }, timeoutMs: NOTIFY_TIMEOUT_MS,
    }).catch((e) => console.warn("[wechat-diary] " + which + " 失败(忽略):", e && e.message));
  }
}

// ── 会话状态机 + 消息路由(019 main.py/session_state.py + 020 两处修复)──

class DiaryAgent {
  // plugin 提供: settings / persist() / data.profile / data.session / ai / writer / chatHandler
  constructor(plugin) {
    this.plugin = plugin;
    this.ai = plugin.ai;
    this.writer = plugin.writer;
    this.chatHandler = plugin.chatHandler;
    this.offlineNotice = null; // 启动时算好, 第一条回复后清空
  }

  get profile() { return this.plugin.data.profile; }
  get session() { return this.plugin.data.session; }

  // 跨天处理(020「午夜割裂」修复: 宽限期 + 显式告知)。
  // 返回 { graceDate?: string, expiredNotice?: string }
  async _loadOrReset() {
    const s = this.session;
    const today = todayStr();
    if (!s.entered_date) {
      Object.assign(s, { mode: "chat", entered_date: today, chat_count_today: 0 });
      return {};
    }
    if (s.entered_date === today) return {};
    if (s.mode === "diary") {
      const gap = Date.now() - (s.last_activity_ts || 0);
      const wasYesterday = s.entered_date === yesterdayStr();
      const cfg = Number(this.plugin.settings.graceMinutes);
      const graceMs = (cfg > 0 ? cfg : 30) * 60000;
      if (wasYesterday && gap <= graceMs) {
        return { graceDate: s.entered_date }; // 同一晚的延续, 保持 diary 模式
      }
      const oldDate = s.entered_date;
      await this.writer.finalizeDay(oldDate); // 自动封存, 封存注脚用当前时间
      Object.assign(s, { mode: "chat", entered_date: today, chat_count_today: 0 });
      return { expiredNotice: GRACE_EXPIRED_NOTICE };
    }
    Object.assign(s, { mode: "chat", entered_date: today, chat_count_today: 0 }); // chat 跨天静默重置
    return {};
  }

  _enterDiary() {
    Object.assign(this.session, { mode: "diary", entered_date: todayStr(), chat_count_today: 0, last_activity_ts: Date.now() });
    this.chatHandler.resetHistory();
  }

  _exitDiary() {
    Object.assign(this.session, { mode: "chat", entered_date: todayStr(), chat_count_today: 0 });
  }

  async _writeEntry(text, isVoice, dateStr) {
    this.session.last_activity_ts = Date.now();
    const { reply, n } = await this.writer.write(text, isVoice, dateStr);
    if (n > 0 && n % NUDGE_EVERY === 0) return reply + "\n\n" + NUDGE_TEXT;
    return reply;
  }

  // 主业务路由(019 main.py _handle)
  async _handle(text, isVoice, cross) {
    const s = this.session;
    const det = detectIntent(text);
    const writeDate = cross.graceDate || undefined;

    if (det.intent === INTENT.HELP) return HELP_TEXT;

    if (s.mode === "diary") {
      if (det.intent === INTENT.UNDO) {
        const ok = await this.writer.undoLastBlock(writeDate);
        return ok ? UNDO_OK_REPLY : UNDO_EMPTY_REPLY;
      }
      if (det.intent === INTENT.FINALIZE) {
        const ok = await this.writer.finalizeDay(writeDate);
        if (!ok) return FINALIZE_EMPTY_REPLY;
        this._exitDiary();
        this.chatHandler.resetHistory();
        const name = this.profile.name || null;
        return randomClosing(name);
      }
      // diary 模式下其余所有意图都当日记记(再说"开始记日记"就当内容写入, 不重复进入)
      return this._writeEntry(text, isVoice, writeDate);
    }

    // === CHAT 模式 ===
    if (det.intent === INTENT.START_DIARY) {
      this._enterDiary();
      let reply = randomChoice(ENTER_DIARY_REPLIES);
      if (det.suspect) {
        // 020 修复: 长句触发切换时整句作为第一条日记写入, 内容不丢; 误判可「撤回」
        const writeReply = await this._writeEntry(text, isVoice);
        return reply + "\n\n" + writeReply;
      }
      // 「叫我小明, 开始记日记」: 同句里的显式称呼别丢
      const inlineName = extractExplicitName(text);
      if (inlineName) {
        this.profile.name = inlineName;
        this.profile.state = "active";
        reply += "\n\n" + NAME_INLINE_CONFIRM_TEMPLATE.split("{name}").join(inlineName);
      }
      return reply;
    }

    if (det.intent === INTENT.UNDO) return NOT_IN_DIARY_HINTS.undo;
    if (det.intent === INTENT.FINALIZE) return NOT_IN_DIARY_HINTS.finalize;

    // 显式「叫我XX」→ 设置/修改称呼(仅 chat 模式; diary 模式照记不误)
    const newName = extractExplicitName(text);
    if (newName) {
      this.profile.name = newName;
      this.profile.state = "active";
      return RENAME_CONFIRM_TEMPLATE.split("{name}").join(newName);
    }

    let reply;
    if (det.intent === INTENT.CHAT) reply = randomChoice(CHAT_GREETING_REPLIES);
    else reply = await this.chatHandler.chat(text);

    // 020 修复: 成本提示每天最多一次(019 从第 2 条起每条都追加, 太烦)
    const s2 = this.session;
    const today = todayStr();
    s2.chat_count_today = (s2.chat_count_today || 0) + 1;
    if (s2.chat_count_today === 2 && this.ai.ready() && s2.cost_reminder_shown_date !== today) {
      s2.cost_reminder_shown_date = today;
      reply += CHAT_COST_REMINDER;
    }
    return reply;
  }

  // 首次见面欢迎 + 取名流程, 之后才走主路由(019 main.py _dispatch)
  async _dispatch(text, isVoice) {
    const cross = await this._loadOrReset();
    const profile = this.profile;

    let reply;
    if (profile.state !== "active" && this.session.mode === "diary") {
      // 已在 diary 的非 active 用户: 内容优先, 取名流程不得吞日记
      reply = await this._handle(text, isVoice, cross);
    } else if (profile.state === "unknown" || !profile.state) {
      profile.state = "awaiting_name";
      reply = WELCOME_TEXT;
    } else if (profile.state === "awaiting_name") {
      const det = detectIntent(text);
      if (det.intent === INTENT.HELP) {
        reply = HELP_TEXT + "\n\n" + STILL_AWAITING_NAME_HINT;
      } else if (det.intent === INTENT.CHAT) {
        reply = randomChoice(CHAT_GREETING_REPLIES) + "\n\n" + STILL_AWAITING_NAME_HINT;
      } else if (det.intent === INTENT.FINALIZE || det.intent === INTENT.UNDO) {
        const key = det.intent === INTENT.UNDO ? "undo" : "finalize";
        reply = NOT_IN_DIARY_HINTS[key] + "\n\n" + STILL_AWAITING_NAME_HINT;
      } else if (det.intent === INTENT.START_DIARY) {
        // 取名不拦路: 放行命令; 同句带名字先收下
        const { name } = extractName(text);
        if (name) { profile.name = name; }
        profile.state = "active";
        reply = await this._handle(text, isVoice, cross);
        if (reply) {
          const tail = name ? NAME_INLINE_CONFIRM_TEMPLATE.split("{name}").join(name) : NAME_LATER_HINT;
          reply = reply + "\n\n" + tail;
        }
      } else {
        const { name: extracted, refused } = extractName(text);
        let name = extracted;
        if (refused) {
          profile.state = "active";
          reply = NAME_SKIPPED_REPLY;
        } else {
          if (name == null && this.ai.ready()) name = await this.ai.llmExtractName(text);
          if (name == null) {
            reply = NAME_UNCLEAR_HINT;
          } else {
            profile.name = name;
            profile.state = "active";
            reply = NAME_CONFIRM_TEMPLATE.split("{name}").join(name);
          }
        }
      }
    } else {
      reply = await this._handle(text, isVoice, cross);
    }

    if (reply && cross.expiredNotice) reply = cross.expiredNotice + "\n\n" + reply; // 告知在前(§3.3)
    return reply;
  }

  // 入口: 白名单兜底 → 路由 → 离线提示一次性附注
  async onMessage(fromUserId, text, isVoice) {
    // 陌生人静默丢弃(_handleIncoming 已挡, 这里兜底): 回复等于向未授权者确认 bot 存活
    if (fromUserId !== this.plugin.data.ilink.userId) return null;
    let reply = await this._dispatch(text, isVoice);
    if (reply && this.offlineNotice) {
      reply = reply + "\n\n" + this.offlineNotice;
      this.offlineNotice = null;
    }
    await this.plugin.persist();
    return reply;
  }
}

// ── 扫码绑定 Modal ───────────────────────────────────────────────────────

class QrLoginModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.aborted = false;
    this.verifyCode = null;
    this.verifyResolve = null;
  }

  onOpen() {
    this.plugin._activeQrModal = this; // 插件卸载时要能关掉这个弹窗
    this.titleEl.setText("扫码绑定微信");
    const c = this.contentEl;
    c.addClass("wechat-diary-qr-modal");
    this.statusEl = c.createEl("p", { text: "正在获取二维码…", cls: "wechat-diary-qr-status" });
    this.imgWrap = c.createDiv({ cls: "wechat-diary-qr-imgwrap" });
    this.verifyWrap = c.createDiv({ cls: "wechat-diary-qr-verify" });
    this.verifyWrap.hide();
    c.createEl("p", {
      cls: "wechat-diary-qr-hint",
      text: "用手机微信扫码, 在打开的页面里确认绑定。二维码过期会自动刷新。",
    });
    this._run();
  }

  onClose() {
    this.aborted = true;
    if (this.verifyResolve) { this.verifyResolve(null); this.verifyResolve = null; }
    // 立刻掐断在途轮询, 不等 35s 超时后才走到 _run 的 finally
    if (this._client) { this._client.destroyAll(); this._client = null; }
    if (this.plugin._activeQrModal === this) this.plugin._activeQrModal = null;
    this.contentEl.empty();
  }

  _setStatus(text) { if (!this.aborted) this.statusEl.setText(text); }

  _renderQr(pageUrl) {
    this.imgWrap.empty();
    try {
      const qr = qrcode(0, "M");
      qr.addData(pageUrl);
      qr.make();
      const dataUrl = qr.createDataURL(6, 8);
      this.imgWrap.createEl("img", { cls: "wechat-diary-qr-img", attr: { src: dataUrl, alt: "微信扫码" } });
    } catch (e) {
      // 编码失败兜底: 给官方二维码页面链接
      this.imgWrap.createEl("a", { text: "打开官方二维码页面", attr: { href: pageUrl, target: "_blank" } });
    }
  }

  _askVerifyCode() {
    this.verifyWrap.show();
    this.verifyWrap.empty();
    this.verifyWrap.createEl("p", { text: "微信提示需要验证: 输入手机微信上显示的数字" });
    let inputEl;
    new Setting(this.verifyWrap)
      .addText((t) => { inputEl = t.inputEl; t.setPlaceholder("验证码"); })
      .addButton((b) => b.setButtonText("提交").setCta().onClick(() => {
        const v = (inputEl.value || "").trim();
        if (v && this.verifyResolve) { this.verifyWrap.hide(); this.verifyResolve(v); this.verifyResolve = null; }
      }));
    return new Promise((resolve) => { this.verifyResolve = resolve; });
  }

  async _run() {
    const plugin = this.plugin;
    let client;
    try {
      client = new ILinkClient();
    } catch (e) {
      this._setStatus(String(e && e.message));
      return;
    }
    this._client = client;
    const startTs = Date.now();
    let refreshes = 0;
    let verifyCode = null;
    try {
      const oldToken = plugin.getBotToken();
      let { qrcode: ticket, qrPageUrl } = await client.getQrcode(oldToken ? [oldToken] : []);
      this._renderQr(qrPageUrl);
      this._setStatus("等待扫码…");
      let pollBase = FIXED_BASE_URL;
      let qrIssuedAt = Date.now();
      const refreshQr = async (statusText) => {
        refreshes += 1;
        if (refreshes > 3) return false;
        const fresh = await client.getQrcode(plugin.getBotToken() ? [plugin.getBotToken()] : []);
        ticket = fresh.qrcode;
        verifyCode = null; // 新码不携带旧验证码
        qrIssuedAt = Date.now();
        this._renderQr(fresh.qrPageUrl);
        this._setStatus(statusText);
        return true;
      };

      while (!this.aborted) {
        if (Date.now() - startTs > LOGIN_TOTAL_TIMEOUT_MS) { this._setStatus("登录超时了, 关掉重试一次吧"); return; }
        if (Date.now() - qrIssuedAt > QR_LOCAL_TTL_MS) {
          try {
            if (!(await refreshQr("二维码刷新了, 重新扫一下~"))) { this._setStatus("二维码多次失效, 稍后再试吧"); return; }
          } catch (e) {
            await sleepMs(2000); // 主动换码撞上网络抖动: 重试, 别把登录整个判死(refreshes 计数天然封顶)
          }
          continue;
        }
        let r;
        try {
          r = await client.pollQrStatus(pollBase, ticket, verifyCode);
        } catch (e) {
          await sleepMs(1000); // 网关抖动(5xx/524 等)视为 wait
          continue;
        }
        if (r.__timeout) continue; // 长轮询正常心跳
        const st = r.json && r.json.status;

        if (st === "confirmed") {
          const j = r.json;
          if (!j.ilink_bot_id) { this._setStatus("登录响应缺 bot_id, 换个姿势再试一次?"); return; }
          await plugin.onLoginConfirmed({
            botToken: j.bot_token, botId: j.ilink_bot_id,
            userId: j.ilink_user_id, baseUrl: (j.baseurl || "").trim(),
          });
          new Notice("微信绑定成功 📖");
          this.close();
          return;
        }
        if (st === "binded_redirect") {
          // 成功语义: 本地已有凭据继续有效, 不下发新凭据
          if (plugin.getBotToken() && plugin.data.ilink.userId) {
            new Notice("这个 bot 已经绑定过了, 沿用现有登录");
            this.close();
          } else {
            this._setStatus("该 bot 已绑定到别处。用当初绑定它的设备解绑, 或换个微信号扫。");
          }
          return;
        }
        if (st === "expired") {
          if (!(await refreshQr("二维码刷新了, 重新扫一下~"))) { this._setStatus("二维码多次失效, 稍后再试吧"); return; }
          continue;
        }
        if (st === "scaned_but_redirect") {
          if (r.json.redirect_host) pollBase = "https://" + r.json.redirect_host;
          continue;
        }
        if (st === "need_verifycode") {
          if (verifyCode) this._setStatus("验证码不对, 再输一次");
          else this._setStatus("需要输入验证码");
          verifyCode = await this._askVerifyCode();
          if (this.aborted || !verifyCode) return;
          continue; // 提交验证码后立即轮询, 不 sleep
        }
        if (st === "verify_code_blocked") {
          verifyCode = null;
          if (!(await refreshQr("验证码多次输错, 换了张新码, 重新扫"))) { this._setStatus("验证码多次输错被暂时限制, 过一会儿再试"); return; }
          continue;
        }
        if (st === "scaned") { verifyCode = null; this._setStatus("已扫码, 在手机上确认一下…"); } // 走到 scaned 说明验证码已通过, 清暂存(同官方)
        // wait 及未知状态(官方枚举外): 继续轮询
        await sleepMs(1000);
      }
    } catch (e) {
      console.error("[wechat-diary] 登录失败:", e);
      this._setStatus("登录出错: " + String(e && e.message));
    } finally {
      client.destroyAll();
    }
  }
}

function sleepMs(ms) { return new Promise((r) => window.setTimeout(r, ms)); }

class ConfirmUnbindModal extends Modal {
  constructor(app, onConfirm) { super(app); this.onConfirm = onConfirm; }
  onOpen() {
    this.titleEl.setText("解除微信绑定?");
    this.contentEl.createEl("p", { text: "会清掉本机的登录凭据和同步进度, 日记文件不受影响。之后可以重新扫码绑定。" });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("解除绑定").setWarning().onClick(() => { this.close(); this.onConfirm(); }))
      .addButton((b) => b.setButtonText("先不了").onClick(() => this.close()));
  }
  onClose() { this.contentEl.empty(); }
}

// ── 设置页 ───────────────────────────────────────────────────────────────

class WechatDiarySettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const plugin = this.plugin;

    new Setting(containerEl).setName("微信").setHeading();

    const bound = Boolean(plugin.getBotToken() && plugin.data.ilink.userId);
    const bindDesc = bound
      ? "已绑定 (" + String(plugin.data.ilink.userId).slice(0, 18) + "…)。消息管道在 Obsidian 打开期间运行。"
      : "未绑定。扫码后, 对微信 bot 说话就能写进库里。";
    new Setting(containerEl)
      .setName("绑定状态")
      .setDesc(bindDesc)
      .addButton((b) => b.setButtonText(bound ? "重新扫码" : "扫码绑定").setCta()
        .onClick(() => new QrLoginModal(this.app, plugin).open()))
      .addButton((b) => {
        b.setButtonText("解除绑定").onClick(() => {
          new ConfirmUnbindModal(this.app, async () => {
            await plugin.unbind();
            this.display();
          }).open();
        });
        if (!bound) b.setDisabled(true);
      });

    // 日记文件夹: 输入即搜索(同核心设置"附件默认存放路径"的交互)——
    // 打字过滤全库任意深度的文件夹, 点选即填; 输入不存在的路径会在写入时自动创建
    const curFolder = plugin.settings.diaryFolder || "日记";
    const appRef = this.app;
    new Setting(containerEl)
      .setName("日记文件夹")
      .setDesc("按 年/日期.md 存放 (与 Python 版数据契约一致)。打几个字搜索库里的文件夹(含子文件夹)直接选; 输入新路径会自动创建")
      .addText((t) => {
        t.setPlaceholder("日记").setValue(curFolder)
          .onChange(async (v) => { plugin.settings.diaryFolder = (v || "").trim() || "日记"; await plugin.persist(); });
        if (typeof AbstractInputSuggest === "function") {
          new (class extends AbstractInputSuggest {
            getSuggestions(query) {
              const q = (query || "").toLowerCase();
              const folders = typeof appRef.vault.getAllFolders === "function"
                ? appRef.vault.getAllFolders()
                : appRef.vault.getAllLoadedFiles().filter((f) => Array.isArray(f.children));
              return folders
                .filter((f) => f.path && f.path !== "/" && f.path.toLowerCase().includes(q))
                .slice(0, 80);
            }
            renderSuggestion(folder, el) { el.setText(folder.path); }
            selectSuggestion(folder) {
              t.setValue(folder.path);
              plugin.settings.diaryFolder = folder.path;
              plugin.persist();
              this.close();
            }
          })(appRef, t.inputEl);
        }
      });

    // 时区: 引擎支持就给完整 IANA 下拉, 不支持退回文本框
    const curTz = plugin.settings.timezone || "Asia/Shanghai";
    let tzList = [];
    try { tzList = Intl.supportedValuesOf("timeZone"); } catch (e) { /* 老引擎 */ }
    const tzSetting = new Setting(containerEl)
      .setName("时区")
      .setDesc("日记文件名和时间戳所用时区, 默认北京时间");
    if (tzList.length) {
      const tzOptions = {};
      if (!tzList.includes(curTz)) tzOptions[curTz] = curTz;
      for (const z of tzList) tzOptions[z] = z;
      tzSetting.addDropdown((d) => d.addOptions(tzOptions).setValue(curTz)
        .onChange(async (v) => {
          plugin.settings.timezone = v;
          setTimezone(v);
          await plugin.persist();
        }));
    } else {
      tzSetting.addText((t) => t.setPlaceholder("Asia/Shanghai").setValue(curTz)
        .onChange(async (v) => {
          plugin.settings.timezone = v.trim() || "Asia/Shanghai";
          setTimezone(plugin.settings.timezone);
          await plugin.persist();
        }));
    }

    new Setting(containerEl).setName("AI 润色与闲聊 (可选)").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "不配也完整可用: 原文直存, 闲聊走固定文案。配了以后写入前轻度润色、闲聊走大模型。",
    });

    new Setting(containerEl)
      .setName("接口地址")
      .setDesc("OpenAI 兼容接口的完整地址, 一般以 /v1/chat/completions 结尾")
      .addText((t) => t.setPlaceholder("https://api.example.com/v1/chat/completions")
        .setValue(plugin.settings.aiApiUrl)
        .onChange(async (v) => { plugin.settings.aiApiUrl = v.trim(); await plugin.persist(); }));

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("存在 Obsidian 的密钥存储里, 不进 vault 文件、不被同步盘带走")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("sk-…").setValue(plugin.getAiKey() || "")
          .onChange((v) => { plugin.setAiKey(v.trim()); });
      });

    new Setting(containerEl)
      .setName("模型名")
      .addText((t) => t.setPlaceholder("deepseek-chat")
        .setValue(plugin.settings.aiModel)
        .onChange(async (v) => { plugin.settings.aiModel = v.trim(); await plugin.persist(); }));
  }
}

// ── 插件主类 ─────────────────────────────────────────────────────────────

const DEFAULT_DATA = () => ({
  settings: Object.assign({}, DEFAULT_SETTINGS),
  ilink: {
    botId: "", userId: "", baseUrl: "", buf: "",
    contextTokens: {}, recentSeqs: [], pauseUntil: 0, lastAliveTs: 0, loginTime: "",
    botTokenFallback: "",
  },
  profile: { state: "unknown", name: null },
  session: { mode: "chat", entered_date: "", chat_count_today: 0, last_activity_ts: 0, cost_reminder_shown_date: "" },
});

class WechatDiaryPlugin extends Plugin {
  async onload() {
    const stored = (await this.loadData()) || {};
    const base = DEFAULT_DATA();
    this.data = {
      settings: Object.assign(base.settings, stored.settings),
      ilink: Object.assign(base.ilink, stored.ilink),
      profile: Object.assign(base.profile, stored.profile),
      session: Object.assign(base.session, stored.session),
    };
    this.settings = this.data.settings;
    setTimezone(this.settings.timezone);

    this.ai = new AiClient(this);
    this.writer = new DiaryWriter(this, this.ai);
    this.chatHandler = new ChatHandler(this.ai);
    this.agent = new DiaryAgent(this);

    this._running = false;
    this._client = null;
    this._failCount = 0;
    this._noticedDown = false;
    this._sleepCancels = new Set();
    this._unloaded = false;
    this._activeQrModal = null;

    this.settingTab = new WechatDiarySettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.statusEl = this.addStatusBarItem();
    this._setStatus("未绑定");

    this.addCommand({
      id: "open-today-note",
      name: "打开今天的日记",
      callback: () => {
        const path = this.writer.diaryPath(todayStr());
        this.app.workspace.openLinkText(path, "", false);
      },
    });

    // 每 5 分钟持久化一次心跳时间(离线提示与补收判断用)
    this.registerInterval(window.setInterval(() => {
      if (this._running) this.persist();
    }, 5 * 60 * 1000));

    this.app.workspace.onLayoutReady(() => {
      if (this.getBotToken() && this.data.ilink.userId) this.startPipeline();
    });
  }

  onunload() {
    this._unloaded = true;
    if (this._activeQrModal) {
      try { this._activeQrModal.close(); } catch (e) { /* noop */ }
      this._activeQrModal = null;
    }
    this.stopPipeline();
  }

  // ── 凭据 ──

  _secrets() { return this.app.secretStorage || null; }

  getBotToken() {
    const ss = this._secrets();
    if (ss) { const v = ss.getSecret(SECRET_BOT_TOKEN); if (v) return v; }
    return this.data.ilink.botTokenFallback || "";
  }

  setBotToken(token) {
    const ss = this._secrets();
    if (ss) { ss.setSecret(SECRET_BOT_TOKEN, token || ""); this.data.ilink.botTokenFallback = ""; }
    else this.data.ilink.botTokenFallback = token || "";
  }

  getAiKey() {
    const ss = this._secrets();
    if (ss) { const v = ss.getSecret(SECRET_AI_KEY); if (v) return v; }
    return "";
  }

  setAiKey(key) {
    const ss = this._secrets();
    if (ss) ss.setSecret(SECRET_AI_KEY, key || "");
    else new Notice("需要 Obsidian 1.11.4+ 才能安全保存 Key");
  }

  async persist() { await this.saveData(this.data); }

  _setStatus(text) { this.statusEl.setText("📖 微信日记: " + text); }

  // ── 绑定生命周期 ──

  async onLoginConfirmed({ botToken, botId, userId, baseUrl }) {
    if (this._unloaded) return; // 弹窗可能活得比插件久, 别在已卸载实例上起管道
    this.stopPipeline();
    this.setBotToken(botToken);
    const il = this.data.ilink;
    const sameUser = il.userId === userId;
    Object.assign(il, {
      botId, userId, baseUrl,
      loginTime: new Date().toISOString(),
      pauseUntil: 0,
      // 换了微信号绑定 = 换了主人: 同步进度和称呼各归各
      buf: sameUser ? il.buf : "",
      contextTokens: sameUser ? il.contextTokens : {},
      recentSeqs: sameUser ? il.recentSeqs : [],
    });
    if (!sameUser) {
      this.data.profile = { state: "unknown", name: null };
      this.data.session = DEFAULT_DATA().session;
    }
    await this.persist();
    this.startPipeline();
    this._refreshSettingsUi(); // 绑定成功后设置页立即显示"已绑定", 不能还挂着扫码按钮
  }

  _refreshSettingsUi() {
    try {
      const t = this.settingTab;
      if (t && t.containerEl && t.containerEl.childElementCount > 0) t.display();
    } catch (e) { /* 设置页没开着, 不用刷 */ }
  }

  async unbind() {
    this.stopPipeline();
    this.setBotToken("");
    const keep = this.data.settings;
    this.data = DEFAULT_DATA();
    this.data.settings = keep;
    this.settings = keep;
    await this.persist();
    this._setStatus("未绑定");
  }

  // ── 消息管道 ──

  startPipeline() {
    if (this._running) return;
    try {
      this._client = new ILinkClient();
    } catch (e) {
      this._setStatus("仅桌面端可用");
      return;
    }
    this._client.token = this.getBotToken();
    this._client.baseUrl = this.data.ilink.baseUrl;
    this._running = true;
    this._failCount = 0;
    this._noticedDown = false;
    this.agent.offlineNotice = this._computeOfflineNotice();
    if (!this._isPaused()) this._client.notify("notifystart");
    this._setStatus("已连接");
    this._loop().catch((e) => {
      console.error("[wechat-diary] 管道异常退出:", e);
      this._running = false;
      this._setStatus("管道异常, 重启插件恢复");
    });
  }

  _isPaused() {
    const p = this.data.ilink.pauseUntil;
    return Boolean(p && Date.now() < p);
  }

  stopPipeline() {
    if (!this._running && !this._client) return;
    this._running = false;
    if (this._client) {
      this._client.notify("notifystop");
      const c = this._client;
      window.setTimeout(() => c.destroyAll(), 500); // 给 notifystop 半秒钟发出去
      this._client = null;
    }
    for (const cancel of [...this._sleepCancels]) cancel();
    this.data.ilink.lastAliveTs = Date.now();
    this.persist();
  }

  _computeOfflineNotice() {
    const ts = this.data.ilink.lastAliveTs;
    if (!ts) return null;
    const gapH = (Date.now() - ts) / 3600000;
    if (gapH < OFFLINE_NOTICE_GAP_H) return null;
    return "(小提示: 我离线了大约 " + Math.floor(gapH) + " 小时, 期间你发的消息我可能没收到, " +
      "翻一下聊天记录, 漏了的可以再发我一次)";
  }

  _interruptibleSleep(ms) {
    // Set 而非单字段: 理论上只有一个 loop 在睡, 但生命周期切换的瞬间可能有两个
    return new Promise((resolve) => {
      const cancel = () => { window.clearTimeout(t); this._sleepCancels.delete(cancel); resolve(); };
      const t = window.setTimeout(() => { this._sleepCancels.delete(cancel); resolve(); }, ms);
      this._sleepCancels.add(cancel);
    });
  }

  async _loop() {
    // 代数守卫: 重新扫码会换 client 实例; 任何 await 回来后发现 client 换了就自杀,
    // 否则旧 loop 会和新 loop 并发轮询同一个 buf(双循环 bug)
    const client = this._client;
    const dead = () => !this._running || this._client !== client;
    let pollTimeout = LONG_POLL_TIMEOUT_MS;
    while (!dead()) {
      const il = this.data.ilink;
      // -14 冷却: 不清 token 不重登, 用同一 token 同一 buf 等冷却结束继续
      if (this._isPaused()) {
        const left = il.pauseUntil - Date.now();
        this._setStatus("冷却中, " + Math.ceil(left / 60000) + " 分钟后恢复");
        await this._interruptibleSleep(Math.min(left, 60000));
        continue;
      }

      let r;
      try {
        r = await client.getUpdates(il.buf, pollTimeout);
      } catch (e) {
        if (dead()) break;
        this._failCount += 1;
        if (this._failCount >= 5 && !this._noticedDown) {
          this._noticedDown = true;
          this._setStatus("连不上微信服务, 重试中");
        }
        if (this._failCount >= 3) { this._failCount = 0; await this._interruptibleSleep(30000); }
        else await this._interruptibleSleep(2000);
        continue;
      }
      if (dead()) break;
      if (r.__timeout) continue; // 长轮询正常心跳, 立即下一轮

      const code = respCode(r.json);
      if (code === STALE_TOKEN_ERRCODE) {
        il.pauseUntil = Date.now() + SESSION_PAUSE_MS;
        await this.persist();
        continue;
      }
      if (code !== 0) {
        this._failCount += 1;
        if (this._failCount >= 3) { this._failCount = 0; await this._interruptibleSleep(30000); }
        else await this._interruptibleSleep(2000);
        continue;
      }

      this._failCount = 0;
      if (this._noticedDown) { this._noticedDown = false; this._setStatus("已连接"); }
      il.lastAliveTs = Date.now();

      if (typeof r.json.longpolling_timeout_ms === "number" && r.json.longpolling_timeout_ms > 0) {
        pollTimeout = r.json.longpolling_timeout_ms;
      }

      // 官方是先推进 cursor 再处理; 日记场景反过来——整批处理完才推进 buf,
      // 中途退出/崩溃就重放这一批(recentSeqs 去重兜底), 用户的话不静默丢
      const msgs = Array.isArray(r.json.msgs) ? r.json.msgs : [];
      let batchDone = true;
      for (const msg of msgs) {
        if (dead()) { batchDone = false; break; }
        try { await this._handleIncoming(msg); }
        catch (e) { console.error("[wechat-diary] 处理消息失败:", e); }
      }
      if (batchDone && !dead() && r.json.get_updates_buf) {
        il.buf = r.json.get_updates_buf;
        await this.persist();
      }
    }
  }

  async _handleIncoming(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.message_type === 2) return; // BOT 自己的消息
    if (msg.message_state === 1) return; // GENERATING 半成品
    const il = this.data.ilink;

    // 白名单最先: 协议层没有 allowlist, 陌生人可直达 bot。
    // 不回复(等于确认 bot 存活)、不存 token(data.json 会被陌生人无限撑大), 静默丢弃
    const from = msg.from_user_id || "";
    if (!from || from !== il.userId) return;

    const seqKey = msg.seq != null ? "s" + msg.seq : (msg.message_id != null ? "m" + msg.message_id : "");
    if (seqKey) {
      if (il.recentSeqs.includes(seqKey)) return;
      il.recentSeqs.push(seqKey);
      if (il.recentSeqs.length > MAX_RECENT_SEQS) il.recentSeqs.splice(0, il.recentSeqs.length - MAX_RECENT_SEQS);
    }

    if (msg.context_token) il.contextTokens[from] = msg.context_token;

    // 提取文本: iLink 会把长内容拆成同一条消息的多个 item, 全部拼接
    let text = "";
    let hasText = false;
    let hasVoice = false;
    for (const item of msg.item_list || []) {
      if (item.type === 1 && item.text_item) { text += item.text_item.text || ""; hasText = true; }
      else if (item.type === 3 && item.voice_item) { text += item.voice_item.text || ""; hasVoice = true; }
    }
    if (!hasText && !hasVoice) return; // 图片/文件/视频等, 日记场景忽略
    const isVoice = hasVoice && !hasText;

    const reply = await this.agent.onMessage(from, text, isVoice);
    if (reply && from) {
      // 冷却期不出站(官方 assertSessionActive 语义): 日记已写入, 只是确认回执发不出
      if (this._isPaused() || !this._client) return;
      try {
        await this._client.sendText(from, reply, il.contextTokens[from]);
      } catch (e) {
        if (e && e.ilinkCode === STALE_TOKEN_ERRCODE) {
          il.pauseUntil = Date.now() + SESSION_PAUSE_MS;
          await this.persist();
        }
        console.error("[wechat-diary] 回复失败:", e && e.message);
      }
    }
  }
}

// 测试与协议实测入口(不影响 Obsidian 加载)
WechatDiaryPlugin.__internals = {
  detectIntent, normalizeIntent, extractName, extractExplicitName, validateName, foldRepeats,
  countMessages, isMessageBlock, lastHeaderTime,
  todayStr, hhmmStr, weekdayForDate, yesterdayStr, setTimezone,
  ILinkClient, respCode,
  INTENT, texts: { WELCOME_TEXT, HELP_TEXT, NUDGE_TEXT },
};

module.exports = WechatDiaryPlugin;
