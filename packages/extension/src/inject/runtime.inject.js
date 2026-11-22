/*
 * ScriptBurro page runtime. This file is not a module: the build minifies it and the
 * background prepends it to every registered userscript. It defines one function,
 * __td_boot(cfg, body), which checks the URL rules, builds the GM API the script was
 * granted and then calls the script.
 *
 * Privileged work is done by the background. Every request carries the script's private
 * token, and the background checks the grant again, so a script cannot obtain an API or
 * another script's data by calling the message channel directly.
 */
// eslint-disable-next-line no-unused-vars
function __td_boot(cfg, body) {
  var win = window;
  var doc = document;

  if (cfg.noframes && win.top !== win) return;
  if (cfg.rules) {
    var href = location.href;
    var hit = function (r) { return new RegExp(r.source, r.flags).test(href); };
    if (!cfg.rules.include.some(hit) || cfg.rules.exclude.some(hit)) return;
  }

  var info = {
    script: cfg.meta,
    scriptMetaStr: cfg.metaStr,
    scriptHandler: 'ScriptBurro',
    version: cfg.handlerVersion,
    injectInto: cfg.sandbox ? 'content' : 'page'
  };
  var scope = { GM_info: info, unsafeWindow: win, GM: { info: info } };

  // GM.setBadge(text) or GM.setBadge({ text, title, color }): shows a short status on the
  // ScriptBurro toolbar icon for this tab. Available to every script, with or without
  // @grant. A page-world script has no channel to the extension, so it hands the request
  // to a small relay that ScriptBurro runs next to it in an isolated world.
  var lastBadge = null;
  var badgeArgs = function (o) {
    o = o !== null && typeof o === 'object' ? o : { text: o };
    return { text: o.text === undefined || o.text === null ? '' : String(o.text), title: o.title ? String(o.title) : '', color: o.color ? String(o.color) : '' };
  };
  var setBadge = function (o, sendIt) {
    var json = JSON.stringify(badgeArgs(o));
    if (json === lastBadge) return;
    lastBadge = json;
    sendIt(json);
  };
  if (!cfg.sandbox && cfg.badgeEvent) {
    var CE = win.CustomEvent;
    var dispatch = doc.dispatchEvent.bind(doc);
    scope.GM.setBadge = scope.GM_setBadge = function (o) {
      setBadge(o, function (json) { dispatch(new CE(cfg.badgeEvent, { detail: json })); });
    };
  } else if (!cfg.sandbox) {
    scope.GM.setBadge = scope.GM_setBadge = function () {};
  }

  function start() {
    var run = function () {
      try {
        body.apply(win, cfg.params.map(function (n) { return scope[n]; }));
      } catch (e) {
        console.error('[ScriptBurro] "' + cfg.meta.name + '" failed:', e);
      }
    };
    if (cfg.runAt === 'document-body' && !doc.body) {
      var mo = new MutationObserver(function () {
        if (doc.body) { mo.disconnect(); run(); }
      });
      mo.observe(doc.documentElement || doc, { childList: true, subtree: true });
    } else {
      run();
    }
  }

  if (!cfg.sandbox) { start(); return; }

  // ---- privileged channel -------------------------------------------------------------
  var rt = (typeof browser !== 'undefined' && browser.runtime) || chrome.runtime;
  var rawSend = rt.sendMessage.bind(rt);
  var granted = {};
  cfg.apis.forEach(function (a) { granted[a] = true; });

  function send(method, args) {
    return rawSend({ td: cfg.token, m: method, a: args || [] }).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || 'ScriptBurro: no response from the extension');
      return r.value;
    });
  }
  function quiet(p) { p.catch(function (e) { console.warn('[ScriptBurro]', e.message); }); }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  function toB64(buf) {
    var bytes = new Uint8Array(buf), out = '', i;
    for (i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(out);
  }
  function fromB64(b64) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length), i;
    for (i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  // ---- values -------------------------------------------------------------------------
  var values = null;
  var valuesReady = null;
  var listeners = {};
  var listenerSeq = 0;

  function ensureValues() {
    if (!valuesReady) valuesReady = send('init').then(function (v) { values = v || {}; });
    return valuesReady;
  }
  function need() {
    if (!values) throw new Error('ScriptBurro: values are not loaded yet');
  }
  function notify(key, oldV, newV, remote) {
    Object.keys(listeners).forEach(function (id) {
      var l = listeners[id];
      if (l.key !== key) return;
      try { l.fn(key, clone(oldV), clone(newV), remote); } catch (e) { console.error(e); }
    });
  }
  function getValue(key, def) {
    need();
    return Object.prototype.hasOwnProperty.call(values, key) ? clone(values[key]) : def;
  }
  function setValue(key, val) {
    need();
    key = String(key);
    if (val === undefined) return deleteValue(key);
    var oldV = values[key];
    values[key] = clone(val);
    notify(key, oldV, values[key], false);
    return send('setValue', [key, values[key]]);
  }
  function deleteValue(key) {
    need();
    key = String(key);
    var oldV = values[key];
    delete values[key];
    if (oldV !== undefined) notify(key, oldV, undefined, false);
    return send('deleteValue', [key]);
  }
  function listValues() { need(); return Object.keys(values); }
  function getValues(keys) {
    need();
    var out = {};
    if (Array.isArray(keys)) keys.forEach(function (k) { if (k in values) out[k] = clone(values[k]); });
    else if (keys && typeof keys === 'object') Object.keys(keys).forEach(function (k) { out[k] = getValue(k, keys[k]); });
    else return clone(values);
    return out;
  }
  function setValues(obj) { return Promise.all(Object.keys(obj).map(function (k) { return setValue(k, obj[k]); })); }
  function deleteValues(keys) { return Promise.all(keys.map(deleteValue)); }
  function addValueChangeListener(key, fn) {
    var id = ++listenerSeq; // the 2.9 code reused id 1 for every listener
    listeners[id] = { key: String(key), fn: fn };
    return id;
  }
  function removeValueChangeListener(id) { delete listeners[id]; }

  // ---- events pushed by the background ------------------------------------------------
  var menu = {};
  var menuSeq = 0;
  var notes = {};
  var tabsOpened = {};

  function drain() {
    send('poll').then(function (events) {
      (events || []).forEach(function (ev) {
        if (ev.t === 'value' && values) {
          var oldV = values[ev.key];
          if (ev.deleted) delete values[ev.key]; else values[ev.key] = ev.value;
          notify(ev.key, oldV, ev.deleted ? undefined : ev.value, true);
        } else if (ev.t === 'menu' && menu[ev.id]) {
          try { menu[ev.id](new MouseEvent('click')); } catch (e) { console.error(e); }
        } else if (ev.t === 'note' && notes[ev.id]) {
          var n = notes[ev.id];
          if (ev.kind === 'click' && n.onclick) n.onclick();
          if (ev.kind === 'done') { if (n.ondone) n.ondone(ev.clicked); delete notes[ev.id]; }
        } else if (ev.t === 'tabClosed' && tabsOpened[ev.id]) {
          var t = tabsOpened[ev.id];
          t.closed = true;
          if (typeof t.onclose === 'function') t.onclose();
          delete tabsOpened[ev.id];
        }
      });
    }).catch(function () { /* the extension was reloaded */ });
  }
  try {
    rt.onMessage.addListener(function (m) {
      if (m && m.tdPoke === cfg.id) drain();
    });
  } catch { /* no push channel in this browser: value changes arrive on next load */ }

  // ---- DOM helpers --------------------------------------------------------------------
  function addElement(parent, tag, attrs) {
    if (typeof parent === 'string') { attrs = tag; tag = parent; parent = null; }
    var el = doc.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'textContent') el.textContent = attrs[k]; else el.setAttribute(k, attrs[k]);
    });
    (parent || doc.head || doc.body || doc.documentElement).appendChild(el);
    return el;
  }
  function addStyle(css) { return addElement('style', { textContent: String(css) }); }

  // ---- requests -----------------------------------------------------------------------
  var xhrSeq = 0;

  function encodeBody(data) {
    if (data === undefined || data === null) return Promise.resolve(null);
    if (typeof data === 'string') return Promise.resolve({ t: 'text', v: data });
    if (data instanceof URLSearchParams) return Promise.resolve({ t: 'text', v: data.toString(), type: 'application/x-www-form-urlencoded;charset=UTF-8' });
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      var buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      return Promise.resolve({ t: 'b64', v: toB64(buf) });
    }
    if (data instanceof Blob) return data.arrayBuffer().then(function (b) { return { t: 'b64', v: toB64(b), type: data.type }; });
    if (data instanceof FormData) {
      var parts = [];
      data.forEach(function (v, k) { parts.push([k, v]); });
      return Promise.all(parts.map(function (p) {
        if (typeof p[1] === 'string') return { k: p[0], v: p[1] };
        return p[1].arrayBuffer().then(function (b) { return { k: p[0], b64: toB64(b), type: p[1].type, name: p[1].name }; });
      })).then(function (fields) { return { t: 'form', v: fields }; });
    }
    return Promise.resolve({ t: 'text', v: String(data) });
  }

  function xmlhttpRequest(d) {
    var id = cfg.id + ':' + (++xhrSeq) + ':' + Math.random().toString(36).slice(2);
    var finished = false;
    var type = d.responseType || '';
    var call = function (name, arg) {
      if (typeof d[name] === 'function') {
        try { d[name](arg); } catch (e) { console.error(e); }
      }
    };
    var base = function (extra) {
      var r = { readyState: 4, status: 0, statusText: '', responseHeaders: '', finalUrl: String(d.url), context: d.context };
      Object.keys(extra || {}).forEach(function (k) { r[k] = extra[k]; });
      return r;
    };
    var fail = function (kind, message) {
      if (finished) return;
      finished = true;
      var r = base({ error: message });
      call(kind, r);
      call('onloadend', r);
    };

    call('onloadstart', base({ readyState: 1 }));
    encodeBody(d.data).then(function (bodyData) {
      return send('xhr', [{
        id: id,
        url: new URL(String(d.url), location.href).href,
        method: String(d.method || 'GET').toUpperCase(),
        headers: d.headers || {},
        body: bodyData,
        binary: type === 'arraybuffer' || type === 'blob',
        timeout: Number(d.timeout) || 0,
        anonymous: !!d.anonymous,
        user: d.user,
        password: d.password,
        overrideMimeType: d.overrideMimeType,
        pageUrl: location.href
      }]);
    }).then(function (res) {
      if (finished) return;
      if (res.failed) return fail(res.failed === 'timeout' ? 'ontimeout' : res.failed === 'abort' ? 'onabort' : 'onerror', res.message);
      finished = true;
      var r = base({ status: res.status, statusText: res.statusText, responseHeaders: res.headers, finalUrl: res.finalUrl });
      if (res.b64 !== undefined) {
        var buf = fromB64(res.b64);
        r.response = type === 'blob' ? new Blob([buf], { type: res.mime }) : buf;
      } else {
        r.responseText = res.text;
        r.response = res.text;
        if (type === 'json') {
          try { r.response = JSON.parse(res.text); } catch { r.response = null; }
        } else if (type === 'document') {
          r.response = new DOMParser().parseFromString(res.text, /xml/.test(res.mime) && !/html/.test(res.mime) ? 'text/xml' : 'text/html');
        }
        Object.defineProperty(r, 'responseXML', {
          get: function () { return new DOMParser().parseFromString(res.text, 'text/xml'); }
        });
      }
      call('onreadystatechange', r);
      call('onload', r);
      call('onloadend', r);
    }).catch(function (e) { fail('onerror', e.message); });

    return {
      abort: function () {
        if (finished) return;
        quiet(send('xhrAbort', [id]));
        fail('onabort', 'aborted');
      }
    };
  }

  function xhrPromise(d) {
    var handle;
    var p = new Promise(function (resolve, reject) {
      var o = {};
      Object.keys(d).forEach(function (k) { o[k] = d[k]; });
      o.onload = function (r) { if (d.onload) d.onload(r); resolve(r); };
      ['onerror', 'ontimeout', 'onabort'].forEach(function (k) {
        o[k] = function (r) { if (d[k]) d[k](r); reject(r); };
      });
      handle = xmlhttpRequest(o);
    });
    p.abort = function () { handle.abort(); };
    return p;
  }

  function download(a, b) {
    var d = typeof a === 'string' ? { url: a, name: b } : a;
    var p = send('download', [{ url: new URL(String(d.url), location.href).href, name: d.name, saveAs: !!d.saveAs, pageUrl: location.href }]);
    p.then(function () { if (d.onload) d.onload(); }, function (e) { if (d.onerror) d.onerror({ error: 'not_permitted', details: e.message }); });
    return { abort: function () {} };
  }

  // ---- misc ---------------------------------------------------------------------------
  function registerMenuCommand(name, fn, opts) {
    var id = (opts && opts.id) || cfg.id + ':' + (++menuSeq);
    menu[id] = fn;
    quiet(send('menuRegister', [id, String(name), typeof opts === 'string' ? opts : (opts && opts.accessKey) || '']));
    return id;
  }
  function unregisterMenuCommand(id) {
    delete menu[id];
    quiet(send('menuUnregister', [id]));
  }
  function openInTab(url, opts) {
    var o = typeof opts === 'boolean' ? { active: !opts } : (opts || {});
    var handle = { closed: false, onclose: null, close: function () {} };
    send('openInTab', [new URL(String(url), location.href).href, { active: o.active !== false && !o.loadInBackground, insert: !!o.insert }])
      .then(function (tabId) {
        tabsOpened[tabId] = handle;
        handle.close = function () { quiet(send('closeTab', [tabId])); };
      }).catch(function (e) { console.warn('[ScriptBurro]', e.message); });
    return handle;
  }
  function notification(a, b, c, d) {
    var o = typeof a === 'object' && a ? a : { text: a, title: b, image: c, onclick: d };
    var ondone = typeof a === 'object' && typeof b === 'function' ? b : o.ondone;
    send('notify', [{ text: String(o.text || ''), title: o.title ? String(o.title) : cfg.meta.name, image: o.image, timeout: Number(o.timeout) || 0, url: o.url }])
      .then(function (id) { notes[id] = { onclick: o.onclick, ondone: ondone }; })
      .catch(function (e) { console.warn('[ScriptBurro]', e.message); });
  }
  function setClipboard(text) {
    text = String(text);
    var legacy = function () {
      var ta = doc.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      (doc.body || doc.documentElement).appendChild(ta);
      ta.select();
      try { doc.execCommand('copy'); } finally { ta.remove(); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(legacy);
    legacy();
    return Promise.resolve();
  }
  function getResourceText(name) {
    var r = cfg.resources[name];
    return r ? r.text : null;
  }
  function getResourceURL(name) {
    var r = cfg.resources[name];
    return r ? r.dataUrl : null;
  }
  function cb(p, fn) {
    p.then(function (v) { if (typeof fn === 'function') fn(v); }, function (e) { console.warn('[ScriptBurro]', e.message); });
  }
  var cookie = {
    list: function (d, fn) { send('cookieList', [d || {}, location.href]).then(function (v) { fn(v, null); }, function (e) { fn(null, e.message); }); },
    set: function (d, fn) { send('cookieSet', [d || {}, location.href]).then(function () { if (fn) fn(null); }, function (e) { if (fn) fn(e.message); }); },
    delete: function (d, fn) { send('cookieDelete', [d || {}, location.href]).then(function () { if (fn) fn(null); }, function (e) { if (fn) fn(e.message); }); }
  };

  var impl = {
    addStyle: addStyle,
    addElement: addElement,
    getValue: getValue,
    setValue: function (k, v) { quiet(setValue(k, v)); },
    deleteValue: function (k) { quiet(deleteValue(k)); },
    listValues: listValues,
    getValues: getValues,
    setValues: function (o) { quiet(setValues(o)); },
    deleteValues: function (k) { quiet(deleteValues(k)); },
    addValueChangeListener: addValueChangeListener,
    removeValueChangeListener: removeValueChangeListener,
    log: function () { console.log.apply(console, ['[' + cfg.meta.name + ']'].concat([].slice.call(arguments))); },
    registerMenuCommand: registerMenuCommand,
    unregisterMenuCommand: unregisterMenuCommand,
    openInTab: openInTab,
    xmlhttpRequest: xmlhttpRequest,
    download: download,
    getResourceText: getResourceText,
    getResourceURL: getResourceURL,
    notification: notification,
    setClipboard: function (t) { quiet(setClipboard(t)); },
    getTab: function (fn) { cb(send('getTab'), fn); },
    saveTab: function (o, fn) { cb(send('saveTab', [clone(o)]), fn); },
    getTabs: function (fn) { cb(send('getTabs'), fn); },
    cookie: cookie
  };
  var after = function (fn) { return function () { var a = arguments; return ensureValues().then(function () { return fn.apply(null, a); }); }; };
  var promised = {
    addStyle: function (c) { return Promise.resolve(addStyle(c)); },
    addElement: function (a, b, c) { return Promise.resolve(addElement(a, b, c)); },
    getValue: after(getValue),
    setValue: after(setValue),
    deleteValue: after(deleteValue),
    listValues: after(listValues),
    getValues: after(getValues),
    setValues: after(setValues),
    deleteValues: after(deleteValues),
    addValueChangeListener: function (k, f) { return ensureValues().then(function () { return addValueChangeListener(k, f); }); },
    removeValueChangeListener: function (i) { removeValueChangeListener(i); return Promise.resolve(); },
    log: function () { impl.log.apply(null, arguments); return Promise.resolve(); },
    registerMenuCommand: function (n, f, o) { return Promise.resolve(registerMenuCommand(n, f, o)); },
    unregisterMenuCommand: function (i) { unregisterMenuCommand(i); return Promise.resolve(); },
    openInTab: function (u, o) { return Promise.resolve(openInTab(u, o)); },
    xmlHttpRequest: xhrPromise,
    xmlhttpRequest: xhrPromise,
    download: function (a, b) {
      var d = typeof a === 'string' ? { url: a, name: b } : a;
      return send('download', [{ url: new URL(String(d.url), location.href).href, name: d.name, saveAs: !!d.saveAs, pageUrl: location.href }]);
    },
    getResourceText: function (n) { return Promise.resolve(getResourceText(n)); },
    getResourceUrl: function (n) { return Promise.resolve(getResourceURL(n)); },
    getResourceURL: function (n) { return Promise.resolve(getResourceURL(n)); },
    notification: function (a, b, c, d) { notification(a, b, c, d); return Promise.resolve(); },
    setClipboard: setClipboard,
    getTab: function () { return send('getTab'); },
    saveTab: function (o) { return send('saveTab', [clone(o)]); },
    getTabs: function () { return send('getTabs'); },
    cookie: {
      list: function (d) { return send('cookieList', [d || {}, location.href]); },
      set: function (d) { return send('cookieSet', [d || {}, location.href]); },
      delete: function (d) { return send('cookieDelete', [d || {}, location.href]); }
    }
  };
  scope.GM.setBadge = scope.GM_setBadge = function (o) {
    setBadge(o, function (json) { quiet(send('badge', [JSON.parse(json)])); });
  };

  var promisedName = { xmlhttpRequest: ['xmlHttpRequest', 'xmlhttpRequest'], getResourceURL: ['getResourceUrl', 'getResourceURL'] };

  Object.keys(impl).forEach(function (name) {
    if (!granted[name]) return;
    scope['GM_' + name] = impl[name];
    (promisedName[name] || [name]).forEach(function (n) { scope.GM[n] = promised[n]; });
  });

  if (cfg.urlchange) {
    var last = location.href;
    win.onurlchange = null;
    var check = function () {
      if (location.href === last) return;
      last = location.href;
      var ev = new Event('urlchange');
      ev.url = last;
      win.dispatchEvent(ev);
      if (typeof win.onurlchange === 'function') win.onurlchange(ev);
    };
    if (win.navigation && win.navigation.addEventListener) win.navigation.addEventListener('navigatesuccess', check);
    win.addEventListener('popstate', check);
    win.addEventListener('hashchange', check);
    setInterval(check, 500);
  }

  // Synchronous GM_getValue needs the stored values before the script starts.
  if (cfg.preloadValues) ensureValues().then(start, function (e) { console.error('[ScriptBurro]', e.message); start(); });
  else start();
}
