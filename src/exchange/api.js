import { ValidationError } from '../lib/utils/errors.js';

class ExchangeHandlers {
  constructor(node) { this._node = node; }

  async submitOrder(_rid, _key, payload, handler) {
    try {
      const { side, price, amount } = payload ?? {};
      if (side !== 'buy' && side !== 'sell') throw new ValidationError('side must be buy|sell');
      if (!(typeof price === 'number' && price > 0)) throw new ValidationError('price must be > 0');
      if (!(typeof amount === 'number' && amount > 0)) throw new ValidationError('amount must be > 0');
      const result = await this._node.submitOrder({ side, price, amount });
      handler.reply(null, result);
    } catch (err) { handler.reply(err, null); }
  }

  async getBook(_rid, _key, _payload, handler) {
    try { handler.reply(null, this._node.getBook()); }
    catch (err) { handler.reply(err, null); }
  }

  async getSnapshot(_rid, _key, _payload, handler) {
    try { handler.reply(null, await this._node.getSnapshot()); }
    catch (err) { handler.reply(err, null); }
  }

  async peerEvent(_rid, _key, payload, handler) {
    try {
      this._node.onEvent(payload?.event);
      handler.reply(null, { ok: true });
    } catch (err) { handler.reply(err, null); }
  }

  async whoami(_rid, _key, _payload, handler) {
    try { handler.reply(null, { nodeId: this._node.selfId }); }
    catch (err) { handler.reply(err, null); }
  }
}

export { ExchangeHandlers };
