/* */ 
(function(Buffer) {
  'use strict';
  const safeBuffer = require('safe-buffer');
  const crypto = require('crypto');
  const PerMessageDeflate = require('./PerMessageDeflate');
  const bufferUtil = require('./BufferUtil');
  const ErrorCodes = require('./ErrorCodes');
  const constants = require('./Constants');
  const Buffer = safeBuffer.Buffer;
  class Sender {
    constructor(socket, extensions) {
      this._extensions = extensions || {};
      this._socket = socket;
      this._firstFragment = true;
      this._compress = false;
      this._bufferedBytes = 0;
      this._deflating = false;
      this._queue = [];
    }
    static frame(data, options) {
      const merge = data.length < 1024 || (options.mask && options.readOnly);
      var offset = options.mask ? 6 : 2;
      var payloadLength = data.length;
      if (data.length >= 65536) {
        offset += 8;
        payloadLength = 127;
      } else if (data.length > 125) {
        offset += 2;
        payloadLength = 126;
      }
      const target = Buffer.allocUnsafe(merge ? data.length + offset : offset);
      target[0] = options.fin ? options.opcode | 0x80 : options.opcode;
      if (options.rsv1)
        target[0] |= 0x40;
      if (payloadLength === 126) {
        target.writeUInt16BE(data.length, 2, true);
      } else if (payloadLength === 127) {
        target.writeUInt32BE(0, 2, true);
        target.writeUInt32BE(data.length, 6, true);
      }
      if (!options.mask) {
        target[1] = payloadLength;
        if (merge) {
          data.copy(target, offset);
          return [target];
        }
        return [target, data];
      }
      const mask = crypto.randomBytes(4);
      target[1] = payloadLength | 0x80;
      target[offset - 4] = mask[0];
      target[offset - 3] = mask[1];
      target[offset - 2] = mask[2];
      target[offset - 1] = mask[3];
      if (merge) {
        bufferUtil.mask(data, mask, target, offset, data.length);
        return [target];
      }
      bufferUtil.mask(data, mask, data, 0, data.length);
      return [target, data];
    }
    close(code, data, mask, cb) {
      var buf;
      if (code === undefined) {
        code = 1000;
      } else if (typeof code !== 'number' || !ErrorCodes.isValidErrorCode(code)) {
        throw new Error('first argument must be a valid error code number');
      }
      if (data === undefined || data === '') {
        if (code === 1000) {
          buf = constants.EMPTY_BUFFER;
        } else {
          buf = Buffer.allocUnsafe(2);
          buf.writeUInt16BE(code, 0, true);
        }
      } else {
        buf = Buffer.allocUnsafe(2 + Buffer.byteLength(data));
        buf.writeUInt16BE(code, 0, true);
        buf.write(data, 2);
      }
      if (this._deflating) {
        this.enqueue([this.doClose, buf, mask, cb]);
      } else {
        this.doClose(buf, mask, cb);
      }
    }
    doClose(data, mask, cb) {
      this.sendFrame(Sender.frame(data, {
        fin: true,
        rsv1: false,
        opcode: 0x08,
        mask,
        readOnly: false
      }), cb);
    }
    ping(data, mask) {
      var readOnly = true;
      if (!Buffer.isBuffer(data)) {
        if (data instanceof ArrayBuffer) {
          data = Buffer.from(data);
        } else if (ArrayBuffer.isView(data)) {
          data = viewToBuffer(data);
        } else {
          data = Buffer.from(data);
          readOnly = false;
        }
      }
      if (this._deflating) {
        this.enqueue([this.doPing, data, mask, readOnly]);
      } else {
        this.doPing(data, mask, readOnly);
      }
    }
    doPing(data, mask, readOnly) {
      this.sendFrame(Sender.frame(data, {
        fin: true,
        rsv1: false,
        opcode: 0x09,
        mask,
        readOnly
      }));
    }
    pong(data, mask) {
      var readOnly = true;
      if (!Buffer.isBuffer(data)) {
        if (data instanceof ArrayBuffer) {
          data = Buffer.from(data);
        } else if (ArrayBuffer.isView(data)) {
          data = viewToBuffer(data);
        } else {
          data = Buffer.from(data);
          readOnly = false;
        }
      }
      if (this._deflating) {
        this.enqueue([this.doPong, data, mask, readOnly]);
      } else {
        this.doPong(data, mask, readOnly);
      }
    }
    doPong(data, mask, readOnly) {
      this.sendFrame(Sender.frame(data, {
        fin: true,
        rsv1: false,
        opcode: 0x0a,
        mask,
        readOnly
      }));
    }
    send(data, options, cb) {
      var opcode = options.binary ? 2 : 1;
      var rsv1 = options.compress;
      var readOnly = true;
      if (!Buffer.isBuffer(data)) {
        if (data instanceof ArrayBuffer) {
          data = Buffer.from(data);
        } else if (ArrayBuffer.isView(data)) {
          data = viewToBuffer(data);
        } else {
          data = Buffer.from(data);
          readOnly = false;
        }
      }
      const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
      if (this._firstFragment) {
        this._firstFragment = false;
        if (rsv1 && perMessageDeflate) {
          rsv1 = data.length >= perMessageDeflate._threshold;
        }
        this._compress = rsv1;
      } else {
        rsv1 = false;
        opcode = 0;
      }
      if (options.fin)
        this._firstFragment = true;
      if (perMessageDeflate) {
        const opts = {
          fin: options.fin,
          rsv1,
          opcode,
          mask: options.mask,
          readOnly
        };
        if (this._deflating) {
          this.enqueue([this.dispatch, data, this._compress, opts, cb]);
        } else {
          this.dispatch(data, this._compress, opts, cb);
        }
      } else {
        this.sendFrame(Sender.frame(data, {
          fin: options.fin,
          rsv1: false,
          opcode,
          mask: options.mask,
          readOnly
        }), cb);
      }
    }
    dispatch(data, compress, options, cb) {
      if (!compress) {
        this.sendFrame(Sender.frame(data, options), cb);
        return;
      }
      const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
      this._deflating = true;
      perMessageDeflate.compress(data, options.fin, (_, buf) => {
        options.readOnly = false;
        this.sendFrame(Sender.frame(buf, options), cb);
        this._deflating = false;
        this.dequeue();
      });
    }
    dequeue() {
      while (!this._deflating && this._queue.length) {
        const params = this._queue.shift();
        this._bufferedBytes -= params[1].length;
        params[0].apply(this, params.slice(1));
      }
    }
    enqueue(params) {
      this._bufferedBytes += params[1].length;
      this._queue.push(params);
    }
    sendFrame(list, cb) {
      if (list.length === 2) {
        this._socket.write(list[0]);
        this._socket.write(list[1], cb);
      } else {
        this._socket.write(list[0], cb);
      }
    }
  }
  module.exports = Sender;
  function viewToBuffer(view) {
    const buf = Buffer.from(view.buffer);
    if (view.byteLength !== view.buffer.byteLength) {
      return buf.slice(view.byteOffset, view.byteOffset + view.byteLength);
    }
    return buf;
  }
})(require('buffer').Buffer);
