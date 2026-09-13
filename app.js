/* ══════════════════════════════════════════════════════════════════
   Bitácora HD — app de campo
   Trabaja sin señal: guarda todo en el teléfono y lo sube cuando vuelve
   la conexión. El cerebro sigue siendo el portal en Apps Script.
   ══════════════════════════════════════════════════════════════════ */

/* ►► La URL /exec de la implementación del portal.
   Si algún día publicas una implementación NUEVA (no una versión nueva de
   la misma), cambia esta línea: la URL será otra y la app dejará de
   conectar. Por eso conviene actualizar SIEMPRE la misma implementación,
   con el lápiz → Nueva versión.                                          */
var API = 'https://script.google.com/macros/s/AKfycbwMzw7PydnvsFRz7JNCnp3mGVXgSb-ZoecyT7ss9bs_MoCeaphyxfS4rHGeRgd95oqVBQ/exec';

var G = { token: '', nombre: '', edificios: [], checklist: {}, tipos: [],
          visita: null, chk: [], cola: [] };

/* ── guardar y leer del teléfono ── */
function guardar(k, v) { try { localStorage.setItem('hd_' + k, JSON.stringify(v)); } catch (e) {} }
function leer(k, def) {
  try { var v = localStorage.getItem('hd_' + k); return v ? JSON.parse(v) : def; }
  catch (e) { return def; }
}

/* ── el cuadro de diálogo ── */
function dlg(tit, txt, def, cb, soloOk) {
  var m = el('mdl');
  el('mt').textContent = tit;
  var x = el('mx'); x.innerHTML = '';
  String(txt || '').split('\n').forEach(function (l) {
    var p = document.createElement('div');
    p.style.marginTop = '5px'; p.textContent = l; x.appendChild(p);
  });
  var i = el('mi');
  i.className = (def === null) ? 'oculto' : '';
  if (def !== null) i.value = def || '';
  el('mc').className = soloOk ? 'oculto' : '';
  el('ma').textContent = soloOk ? 'Entendido' : 'Aceptar';
  m.style.display = 'flex';
  el('ma').onclick = function () {
    var val = (def === null) ? true : i.value.trim();
    if (def !== null && !val) return;
    m.style.display = 'none'; if (cb) cb(val);
  };
  el('mc').onclick = function () { m.style.display = 'none'; };
  if (def !== null) setTimeout(function () { i.focus(); }, 80);
}
var confirmar = function (t, x, cb) { dlg(t, x, null, cb); };
var preguntar = function (t, x, d, cb) { dlg(t, x, d || '', cb); };
var avisar = function (x, t) { dlg(t || 'Aviso', x, null, null, true); };

function el(id) { return document.getElementById(id); }
function hoy() { return new Date().toISOString().slice(0, 10); }
function hora() {
  var d = new Date();
  return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}

/* ── hablar con el portal ──
   Se manda como texto plano a propósito: así el navegador lo trata como
   petición simple y no pide permiso previo al servidor.               */
function api(datos) {
  return fetch(API, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(datos)
  }).then(function (r) { return r.json(); });
}

/* ── estado de la conexión ── */
function pintarRed() {
  var r = el('red');
  if (navigator.onLine) { r.textContent = 'En línea'; r.className = 'red'; }
  else { r.textContent = 'Sin señal'; r.className = 'red off'; }
}
window.addEventListener('online', function () { pintarRed(); sincronizar(); });
window.addEventListener('offline', pintarRed);

/* ══════════════ ENTRAR ══════════════ */
el('lg_b').onclick = function () {
  var u = el('lg_u').value.trim(), p = el('lg_p').value;
  if (!u || !p) { avisar('Escribe tu usuario y tu contraseña.'); return; }
  if (!navigator.onLine) { avisar('Para entrar la primera vez necesitas conexión. Después ya funciona sin señal.'); return; }
  var b = this; b.disabled = true; b.textContent = 'Entrando...';
  api({ accion: 'login', usuario: u, clave: p })
    .then(function (r) {
      b.disabled = false; b.textContent = 'Entrar';
      if (!r.ok) { el('lg_r').innerHTML = '<div class="aviso mal">' + r.msg + '</div>'; return; }
      G.token = r.token; G.nombre = r.nombre;
      guardar('token', r.token); guardar('nombre', r.nombre);
      descargarCatalogo(function () { abrirApp(); });
    })
    .catch(function () {
      b.disabled = false; b.textContent = 'Entrar';
      el('lg_r').innerHTML = '<div class="aviso mal">No se pudo conectar. Revisa la señal.</div>';
    });
};

/* Trae de una sola vez todo lo que la app necesita para trabajar sin señal. */
function descargarCatalogo(cb) {
  api({ accion: 'catalogo', token: G.token }).then(function (r) {
    if (r.ok) {
      G.edificios = r.edificios || [];
      G.checklist = r.checklist || {};
      G.tipos = r.tiposGestion || [];
      guardar('edificios', G.edificios);
      guardar('checklist', G.checklist);
      guardar('tipos', G.tipos);
      guardar('bajado', new Date().getTime());
    }
    if (cb) cb();
  }).catch(function () { if (cb) cb(); });
}

function abrirApp() {
  el('p_login').className = 'oculto';
  el('p_app').className = '';
  el('saludo').textContent = 'Hola, ' + String(G.nombre).split(' ')[0];
  var e = el('edificio'); e.innerHTML = '';
  G.edificios.forEach(function (x) {
    var o = document.createElement('option'); o.value = x; o.textContent = x; e.appendChild(o);
  });
  var t = el('tipo'); t.innerHTML = '';
  (G.tipos.length ? G.tipos : ['Visita presencial programada']).forEach(function (x) {
    var o = document.createElement('option'); o.value = x; o.textContent = x; t.appendChild(o);
  });
  if (!G.edificios.length) {
    el('avisos').innerHTML = '<div class="aviso mal">No tienes edificios asignados. Pide que te asignen en la hoja EDIFICIOS.</div>';
  }
  pintarVisita();
  pintarCola();
  if (navigator.onLine) sincronizar();
}

/* ══════════════ LA VISITA ══════════════ */
el('b_iniciar').onclick = function () {
  if (G.visita) { avisar('Ya tienes una visita abierta en ' + G.visita.edificio + '. Ciérrala antes de iniciar otra.'); return; }
  var ed = el('edificio').value;
  if (!ed) { avisar('Selecciona el edificio.'); return; }
  var base = (G.checklist[ed] && G.checklist[ed].items) ? G.checklist[ed].items : [];
  G.visita = {
    id: 'L' + Date.now(), edificio: ed, tipo: el('tipo').value,
    fecha: hoy(), horaEnt: hora(), local: true
  };
  G.chk = base.map(function (x) {
    return { clave: x.clave, area: x.area, item: x.item, opcional: x.opcional, estado: 'Conforme', desc: '' };
  });
  guardar('visita', G.visita); guardar('chk', G.chk);
  pintarVisita();
  if (navigator.onLine) {
    api({ accion: 'iniciarVisita', token: G.token, edificio: ed,
          fecha: G.visita.fecha, tipo: G.visita.tipo })
      .then(function (r) {
        if (r.ok) { G.visita.id = r.id; G.visita.local = false; guardar('visita', G.visita); pintarVisita(); }
      }).catch(function () {});
  }
};

function pintarVisita() {
  var c = el('encurso');
  if (!G.visita) { c.innerHTML = ''; el('p_visita').className = 'oculto'; return; }
  c.innerHTML = '<div class="visita"><b>' + G.visita.edificio + '</b>'
    + '<div class="cuando">' + G.visita.tipo + ' · desde las ' + G.visita.horaEnt
    + (G.visita.local ? ' · pendiente de subir' : '') + '</div></div>';
  el('p_visita').className = '';
  pintarChk();
}

function pintarChk() {
  var c = el('chk'); c.innerHTML = '';
  if (!G.chk.length) { c.innerHTML = '<p class="pista">Este edificio no tiene lista de inspección cargada.</p>'; resumen(); return; }
  var area = '';
  G.chk.forEach(function (x, i) {
    if (x.area !== area) {
      area = x.area;
      var h = document.createElement('div'); h.className = 'area'; h.textContent = area; c.appendChild(h);
    }
    var row = document.createElement('div'); row.className = 'pt';
    var nm = document.createElement('div'); nm.className = 'nom'; nm.textContent = x.item; row.appendChild(nm);
    var g = document.createElement('div'); g.className = 'est';
    [['Conforme', 'on-ok', 'Conforme'], ['Con observación', 'on-ob', 'Observación'], ['No conforme', 'on-nc', 'No conforme']]
      .forEach(function (p) {
        var b = document.createElement('button');
        b.className = (x.estado === p[0] ? p[1] : '');
        b.textContent = p[2];
        b.onclick = function () { marcar(i, p[0]); };
        g.appendChild(b);
      });
    if (x.opcional) {
      var bn = document.createElement('button');
      bn.className = 'nt'; bn.textContent = 'No tiene';
      bn.onclick = function () { noTiene(i); };
      g.appendChild(bn);
    }
    row.appendChild(g);
    if (x.estado !== 'Conforme' && x.desc) {
      var d = document.createElement('div'); d.className = 'hallazgo'; d.textContent = x.desc; row.appendChild(d);
    }
    c.appendChild(row);
  });
  resumen();
}

function marcar(i, est) {
  var x = G.chk[i];
  if (est === 'Conforme') { x.estado = 'Conforme'; x.desc = ''; guardar('chk', G.chk); pintarChk(); return; }
  preguntar(x.item, x.area + ' · ' + est + '\nQué se encontró y qué se hizo.', x.desc, function (t) {
    x.estado = est; x.desc = t; guardar('chk', G.chk); pintarChk();
  });
}

function noTiene(i) {
  var x = G.chk[i], ed = G.visita.edificio;
  confirmar(x.item, '¿' + ed + ' no tiene este sistema?\nSe quitará de su lista y no volverá a aparecer.', function () {
    G.chk = G.chk.filter(function (y) { return y.clave !== x.clave; });
    if (G.checklist[ed]) {
      G.checklist[ed].items = G.checklist[ed].items.filter(function (y) { return y.clave !== x.clave; });
      guardar('checklist', G.checklist);
    }
    guardar('chk', G.chk); pintarChk();
    encolar({ accion: 'noTiene', edificio: ed, clave: x.clave, tiene: false });
  });
}

function resumen() {
  var ob = 0, nc = 0;
  G.chk.forEach(function (x) {
    if (x.estado === 'Con observación') ob++; else if (x.estado === 'No conforme') nc++;
  });
  var pc = G.chk.length ? Math.round((G.chk.length - ob - nc) * 100 / G.chk.length) : 100;
  el('kpis').innerHTML =
    kpi(pc + ' %', 'Conformidad') + kpi(ob, 'Observación') + kpi(nc, 'No conformes') + kpi(G.chk.length, 'Puntos');
}
function kpi(n, t) { return '<div class="kpi"><b>' + n + '</b><span>' + t + '</span></div>'; }

/* ── cerrar ── */
el('b_cerrar').onclick = function () {
  var txt = (el('op').value + el('sg').value + el('cv').value).trim();
  var hall = G.chk.filter(function (x) { return x.estado !== 'Conforme'; }).length;
  var msg = txt ? 'Se cerrará la visita con la hora actual.'
    : 'No escribiste ninguna anotación.\nQuedará solo la inspección: ' + G.chk.length
      + ' puntos revisados' + (hall ? ' y ' + hall + ' con novedad' : ' y ningún hallazgo') + '.';
  confirmar('Cerrar visita', msg + '\n\n¿Continuar?', function () {
    var inc = G.chk.filter(function (x) { return x.estado !== 'Conforme' && x.desc; })
      .map(function (x) {
        return { clave: x.clave, tipo: (x.area === 'Seguridad' ? 'Seguridad' : 'Falla de servicio'),
                 desc: '[' + x.area + ' · ' + x.item + '] ' + x.desc, estado: 'Abierto' };
      });
    var d = {
      accion: G.visita.local ? 'registrarVisita' : 'cerrarVisita',
      id: G.visita.id, edificio: G.visita.edificio, fecha: G.visita.fecha,
      tipo: G.visita.tipo, horaEnt: G.visita.horaEnt, horaSal: hora(),
      operativo: el('op').value.trim(), seguridad: el('sg').value.trim(),
      convivencia: el('cv').value.trim(), reqRec: el('rr').value, reqAte: el('ra').value,
      trabajo: el('tr').value.trim(), costo: el('tc').value,
      incidentes: inc, checklist: G.chk, novedades: []
    };
    encolar(d);
    G.visita = null; G.chk = [];
    guardar('visita', null); guardar('chk', []);
    ['op', 'sg', 'cv', 'tr', 'tc'].forEach(function (x) { el(x).value = ''; });
    el('rr').value = 0; el('ra').value = 0;
    pintarVisita();
    el('avisos').innerHTML = '<div class="aviso ok">Visita registrada'
      + (navigator.onLine ? '.' : '. Se subirá cuando vuelva la señal.') + '</div>';
    setTimeout(function () { el('avisos').innerHTML = ''; }, 6000);
  });
};

el('b_descartar').onclick = function () {
  confirmar('Descartar visita', 'Se borrará y no quedará registro. ¿Continuar?', function () {
    if (G.visita && !G.visita.local && navigator.onLine) {
      api({ accion: 'anularVisita', token: G.token, id: G.visita.id }).catch(function () {});
    }
    G.visita = null; G.chk = [];
    guardar('visita', null); guardar('chk', []);
    pintarVisita();
  });
};

/* ══════════════ LA COLA ══════════════ */
function encolar(d) {
  G.cola.push(d);
  guardar('cola', G.cola);
  pintarCola();
  if (navigator.onLine) sincronizar();
}

function pintarCola() {
  var c = el('cola');
  if (!G.cola.length) { c.className = 'cola oculto'; document.body.style.paddingBottom = ''; return; }
  c.className = 'cola';
  document.body.style.paddingBottom = '64px';
  c.innerHTML = '<span style="flex:1">' + G.cola.length + ' registro(s) por subir</span>';
  var b = document.createElement('button');
  b.textContent = navigator.onLine ? 'Subir ahora' : 'Sin señal';
  b.disabled = !navigator.onLine;
  b.onclick = sincronizar;
  c.appendChild(b);
}

var sincronizando = false;
function sincronizar() {
  if (sincronizando || !navigator.onLine || !G.cola.length || !G.token) return;
  sincronizando = true;
  var d = G.cola[0];
  d.token = G.token;
  api(d).then(function (r) {
    sincronizando = false;
    if (r && r.expirado) {
      avisar('Tu sesión caducó. Vuelve a entrar; lo que registraste no se pierde.');
      return;
    }
    // se saca de la cola aunque el servidor la rechace: si no, se queda trabada
    G.cola.shift();
    guardar('cola', G.cola);
    pintarCola();
    if (G.cola.length) setTimeout(sincronizar, 400);
  }).catch(function () { sincronizando = false; });
}

/* ══════════════ ARRANQUE ══════════════ */
(function () {
  pintarRed();
  G.token = leer('token', '');
  G.nombre = leer('nombre', '');
  G.edificios = leer('edificios', []);
  G.checklist = leer('checklist', {});
  G.tipos = leer('tipos', []);
  G.visita = leer('visita', null);
  G.chk = leer('chk', []);
  G.cola = leer('cola', []);

  if (G.token && G.nombre) {
    abrirApp();
    if (navigator.onLine) descargarCatalogo(function () { abrirApp(); });
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
