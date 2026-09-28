export function createOverlayDom(Base = class {}) {
  class Element extends Base {
    constructor() {
      super();
      this.children = [];
      this.listeners = new Map();
      this.style = { setProperty(name, value) { this[name] = value; } };
      this.dataset = {};
      this.attributes = new Map();
      this.rect = { left: 100, right: 180, top: 100, bottom: 180, width: 80, height: 80 };
      this.ownerDocument = document;
      this.classList = { contains: name => this.className?.split(' ').includes(name), add() {}, remove() {} };
    }
    get isConnected() { return this === document.body || Boolean(this.parentElement?.isConnected); }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
    replaceChildren(...nodes) { for (const node of [...this.children]) node.remove(); this.append(...nodes); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this); this.parentElement = null; }
    contains(node) { return node === this || this.children.some(c => c.contains(node)); }
    getBoundingClientRect() { return this.rect; }
    get scrollHeight() { return this.rect.height; }
    get scrollWidth() { return this.rect.width; }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    removeAttribute(key) { this.attributes.delete(key); }
    focus() { document.activeElement = this; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    closest() { return null; }
    addEventListener(type, callback, options = {}) {
      const entries = this.listeners.get(type) ?? new Set(); entries.add(callback); this.listeners.set(type, entries);
      options.signal?.addEventListener('abort', () => entries.delete(callback), { once: true });
    }
    async emit(type, event = {}) { for (const callback of [...(this.listeners.get(type) ?? [])]) await callback({ target: this, ...event }); }
  }
  const frames = new Map(); let frameId = 0;
  const observers = [];
  class Observer {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const document = { createElement: () => new Element(), activeElement: null };
  const window = {
    innerWidth: 1280, innerHeight: 720, AbortController,
    getComputedStyle: e => ({ zIndex: e.style.zIndex ?? '100', display: 'block', visibility: 'visible' }),
    ResizeObserver: Observer, MutationObserver: Observer,
    requestAnimationFrame: cb => { frames.set(++frameId, cb); return frameId; },
    cancelAnimationFrame: id => frames.delete(id)
  };
  document.defaultView = window;
  document.body = new Element();
  const events = new Element();
  document.addEventListener = events.addEventListener.bind(events);
  window.addEventListener = events.addEventListener.bind(events);
  document.querySelectorAll = () => document.body.children;
  return { document, window, Element, events, observers, frames,
    flush() { for (const [id, cb] of [...frames]) { frames.delete(id); cb(); } },
    fixture() {
      const owner = new Element(), anchor = new Element(), content = new Element();
      content.rect = { left: 0, top: 0, right: 224, bottom: 200, width: 224, height: 200 };
      owner.append(anchor); document.body.append(owner);
      return { owner, anchor, content };
    }
  };
}
