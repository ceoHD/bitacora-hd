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
          visita: null, chk: [], cola: [], fallidos: [] };

/* ── guardar y leer del teléfono ── */
/* Devuelve false si no cupo. Importa desde que hay fotos: el teléfono le
   presta a la app unos 5 MB, y antes esto se tragaba el error en silencio
   —el administrador creía que había guardado y no había nada—.          */
function guardar(k, v) {
  try { localStorage.setItem('hd_' + k, JSON.stringify(v)); return true; }
  catch (e) { return false; }
}
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
  el('lg_r').innerHTML = '';
  api({ accion: 'login', usuario: u, clave: p })
    .then(function (r) {
      if (!r.ok) {
        b.disabled = false; b.textContent = 'Entrar';
        el('lg_r').innerHTML = '<div class="aviso mal">' + r.msg + '</div>';
        return;
      }
      G.token = r.token; G.nombre = r.nombre;
      guardar('token', r.token); guardar('nombre', r.nombre);

      /* Entrar fue lo rápido. Ahora se baja el catálogo —los edificios y la
         lista de inspección de cada uno—, y eso puede tardar un minuto largo
         la primera vez. Sin este aviso la pantalla se queda quieta y parece
         que el botón no hizo nada.                                        */
      b.textContent = 'Entrando...';
      el('lg_r').innerHTML = '<div class="aviso">Hola, ' + String(r.nombre).split(' ')[0] + '.</div>';

      guardar('usuario', u);              // para no volver a escribirlo
      descargarCatalogo(function (ok, msg) {
        b.disabled = false; b.textContent = 'Entrar';
        if (!ok) {
          el('lg_r').innerHTML = '<div class="aviso mal">Entraste, pero no pude bajar '
            + 'tus edificios' + (msg ? (': ' + msg) : '.') + '<br>Vuelve a pulsar Entrar.</div>';
          return;
        }
        if (!G.edificios.length) {
          el('lg_r').innerHTML = '<div class="aviso mal">No tienes edificios asignados. '
            + 'Pide al back office que te designe.</div>';
          return;
        }
        el('lg_r').innerHTML = '';
        abrirApp();
        bajarChecklists();               // el resto, en segundo plano
      });
    })
    .catch(function () {
      b.disabled = false; b.textContent = 'Entrar';
      el('lg_r').innerHTML = '<div class="aviso mal">No se pudo conectar con el portal. '
        + 'Revisa la señal e inténtalo otra vez.</div>';
    });
};

/* Trae de una sola vez todo lo que la app necesita para trabajar sin señal.
   Avisa al terminar si salió bien o no: antes se lo tragaba en silencio y
   la app se abría vacía, sin un solo edificio y sin explicación.         */
function descargarCatalogo(cb) {
  api({ accion: 'catalogo', token: G.token, soloLista: true }).then(function (r) {
    if (!r.ok) { if (cb) cb(false, r.msg || ''); return; }
    G.edificios = r.edificios || [];
    G.tipos = r.tiposGestion || [];
    // las listas de inspección ya bajadas NO se tiran: bajarlas cuesta
    var prev = leer('checklist', {});
    for (var k in (r.checklist || {})) prev[k] = r.checklist[k];
    G.checklist = prev;
    guardar('edificios', G.edificios);
    guardar('checklist', G.checklist);
    guardar('tipos', G.tipos);
    guardar('bajado', new Date().getTime());
    if (cb) cb(true, '');
  }).catch(function (e) { if (cb) cb(false, (e && e.message) || 'se cortó la conexión'); });
}

/* Las listas de inspección se bajan DESPUÉS de entrar, una por una y sin
   bloquear nada. Cada edificio cuesta un par de segundos porque hay que ir
   a Drive; en segundo plano no molesta, y al terminar la app ya trabaja sin
   señal en todos. Si se corta, se retoma la próxima vez.               */
var bajando = false;
function bajarChecklists(cb) {
  if (bajando || !navigator.onLine || !G.token) { if (cb) cb(); return; }
  var faltan = G.edificios.filter(function (e) { return !G.checklist[e]; });
  if (!faltan.length) { avisoChk(''); if (cb) cb(); return; }
  bajando = true;
  var i = 0;
  var siguiente = function () {
    if (i >= faltan.length || !navigator.onLine) {
      bajando = false; avisoChk(''); pintarVisita(); if (cb) cb(); return;
    }
    var ed = faltan[i++];
    avisoChk('Preparando el modo sin señal: ' + i + ' de ' + faltan.length + ' edificios.');
    api({ accion: 'checklist', token: G.token, edificio: ed }).then(function (r) {
      if (r && r.ok) {
        G.checklist[ed] = { items: r.items || [], ocultos: r.ocultos || [] };
        guardar('checklist', G.checklist);
      }
      setTimeout(siguiente, 60);
    }).catch(function () { setTimeout(siguiente, 400); });
  };
  siguiente();
}

function avisoChk(txt) {
  var a = el('avisos'); if (!a) return;
  a.innerHTML = txt ? ('<div class="aviso">' + txt + '</div>') : '';
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
  ['rq_e', 'cm_e'].forEach(function (k) {
    var s = el(k); if (!s) return;
    s.innerHTML = G.edificios.map(function (x) { return '<option>' + x + '</option>'; }).join('');
  });
  if (!G.edificios.length) {
    el('avisos').innerHTML = '<div class="aviso mal">No tienes edificios asignados. '
      + 'Pide al back office que te designe en la hoja REGLAS.</div>';
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
    /* La cámara aparece solo donde hace falta: en lo que está mal. Poner
       el botón en los 24 puntos sería ruido en una pantalla de teléfono. */
    if (x.estado === 'Con observación' || x.estado === 'No conforme') {
      var adj = document.createElement('div'); adj.className = 'adj';
      var bf = document.createElement('button');
      bf.className = 'adjb'; bf.textContent = '📷  Foto';
      bf.onclick = function () { adjuntar(i, true); };
      adj.appendChild(bf);
      var ba = document.createElement('button');
      ba.className = 'adjb'; ba.textContent = '📎  Archivo';
      ba.onclick = function () { adjuntar(i, false); };
      adj.appendChild(ba);
      if (x.adj) {
        var cu = document.createElement('span'); cu.className = 'adjn';
        cu.textContent = x.adj + (x.adj === 1 ? ' adjunto' : ' adjuntos');
        adj.appendChild(cu);
      }
      row.appendChild(adj);
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

/* ══════════════ EVIDENCIAS ══════════════
   Una foto del hallazgo, tomada con el edificio delante, vale más que el
   párrafo que lo describe. Queda unida al punto del checklist, no suelta.  */

var EVID_LADO = 1200;      // el lado mayor de la foto, en píxeles
var EVID_CALIDAD = 0.72;   // compresión JPEG
var EVID_TOPE_DOC = 3;     // MB por documento; las fotos se encogen solas

/* Una foto de celular pesa 4 MB y no cabe en la cola sin señal. Se redibuja
   más pequeña antes de guardarla: a 1200 px se sigue leyendo la placa de un
   motor o la mancha de una filtración, que es para lo que sirve.          */
function encogerFoto(file, cb) {
  var fr = new FileReader();
  fr.onload = function () {
    var img = new Image();
    img.onload = function () {
      var w = img.width, h = img.height, m = Math.max(w, h);
      if (m > EVID_LADO) { var r = EVID_LADO / m; w = Math.round(w * r); h = Math.round(h * r); }
      try {
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(cv.toDataURL('image/jpeg', EVID_CALIDAD), 'image/jpeg');
      } catch (e) { cb(fr.result, file.type); }   // si el canvas falla, va tal cual
    };
    img.onerror = function () { cb(fr.result, file.type); };
    img.src = fr.result;
  };
  fr.onerror = function () { cb(null, ''); };
  fr.readAsDataURL(file);
}

function leerTalCual(file, cb) {
  var fr = new FileReader();
  fr.onload = function () { cb(fr.result, file.type || 'application/octet-stream'); };
  fr.onerror = function () { cb(null, ''); };
  fr.readAsDataURL(file);
}

function adjuntar(i, esFoto) {
  var x = G.chk[i];
  if (!G.visita) { avisar('Primero inicia la visita.'); return; }
  var inp = document.createElement('input');
  inp.type = 'file';
  if (esFoto) { inp.accept = 'image/*'; inp.capture = 'environment'; }
  else { inp.accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx'; }
  inp.onchange = function () {
    var f = inp.files && inp.files[0];
    if (!f) return;
    var esImagen = /^image\//.test(f.type);
    if (!esImagen && f.size > EVID_TOPE_DOC * 1048576) {
      avisar('Ese archivo pesa ' + (f.size / 1048576).toFixed(1) + ' MB y el tope son '
           + EVID_TOPE_DOC + ' MB. Las fotos no tienen ese problema: se encogen solas.');
      return;
    }
    var listo = function (datos, tipo) {
      if (!datos) { avisar('No pude leer el archivo.'); return; }
      var antes = G.cola.slice();
      G.cola.push({
        accion: 'evidencia', edificio: G.visita.edificio, visita: G.visita.id || '',
        clave: x.clave, item: x.item, estado: x.estado,
        nombre: f.name || '', tipo: tipo, datos: datos
      });
      if (!guardar('cola', G.cola)) {
        G.cola = antes; guardar('cola', G.cola);
        avisar('No queda espacio en el teléfono para más adjuntos sin señal. '
             + 'Conéctate para que se suban los que ya tienes y vuelve a intentarlo.',
               'Sin espacio');
        return;
      }
      x.adj = (x.adj || 0) + 1;
      guardar('chk', G.chk);
      pintarChk(); pintarCola();
      if (navigator.onLine) sincronizar();
    };
    if (esImagen) encogerFoto(f, listo); else leerTalCual(f, listo);
  };
  inp.click();
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
  if (!G.cola.length && !G.fallidos.length) {
    c.className = 'cola oculto'; document.body.style.paddingBottom = ''; return;
  }
  c.className = 'cola' + (G.cola.length ? '' : ' mal');
  document.body.style.paddingBottom = '64px';
  c.innerHTML = '';
  var txt = document.createElement('span');
  txt.style.flex = '1';
  txt.textContent = G.cola.length
    ? (G.cola.length + ' registro(s) por subir'
       + (G.fallidos.length ? ('  ·  ' + G.fallidos.length + ' rechazado(s)') : ''))
    : (G.fallidos.length + ' registro(s) NO se pudieron subir');
  c.appendChild(txt);

  if (G.cola.length) {
    var b = document.createElement('button');
    b.textContent = navigator.onLine ? 'Subir ahora' : 'Sin señal';
    b.disabled = !navigator.onLine;
    b.onclick = sincronizar;
    c.appendChild(b);
  } else {
    var v = document.createElement('button');
    v.textContent = 'Ver por qué';
    v.onclick = verFallidos;
    c.appendChild(v);
  }
}

/* Qué se rechazó y por qué. Lo más común: intentar abrir una visita en un
   edificio que ya tiene otra sin cerrar.                                 */
function verFallidos() {
  if (!G.fallidos.length) { avisar('No hay nada rechazado.'); return; }
  var f = G.fallidos[0];
  var qué = f.accion === 'iniciarVisita' ? 'Inicio de visita'
          : f.accion === 'cerrarVisita' ? 'Cierre de visita'
          : f.accion === 'registrarVisita' ? 'Visita completa'
          : f.accion === 'requerimiento' ? 'Requerimiento de compra'
          : f.accion === 'evidencia' ? 'Foto o archivo'
          : f.accion;
  confirmar(qué + ' — rechazado',
    (f.edificio ? (f.edificio + '\n') : '') + f.motivo
    + '\n\nAceptar: volver a intentarlo.\nCancelar: dejarlo en la lista.',
    function () {
      G.fallidos.shift();
      delete f.motivo; delete f.cuando;
      G.cola.push(f);
      guardar('fallidos', G.fallidos); guardar('cola', G.cola);
      pintarCola();
      if (navigator.onLine) sincronizar();
    });
}

// ►► para descartar de veras lo que ya no sirve
function olvidarFallidos() {
  G.fallidos = []; guardar('fallidos', G.fallidos); pintarCola();
}

var sincronizando = false;
function sincronizar() {
  if (sincronizando || !navigator.onLine || !G.cola.length || !G.token) return;
  sincronizando = true;
  var d = G.cola[0];
  d.token = G.token;
  /* Los adjuntos van aparte, y DESPUÉS: el requerimiento todavía no tiene
     número hasta que el servidor lo emite, y sin número el adjunto no
     sabría a qué documento acompañar.                                    */
  var adj = d.adjuntos || [];
  var envio = {};
  for (var k in d) if (k !== 'adjuntos') envio[k] = d[k];

  api(envio).then(function (r) {
    sincronizando = false;
    if (r && r.expirado) {
      avisar('Tu sesión caducó. Vuelve a entrar; lo que registraste no se pierde.');
      return;
    }
    if (r && r.ok && r.num && adj.length) {
      adj.forEach(function (a) {
        G.cola.push({ accion: 'evidencia', origen: 'compra', edificio: d.edificio,
                      referencia: r.num, item: d.requerimiento || '',
                      nombre: a.nombre, tipo: a.tipo, datos: a.datos });
      });
    }
    /* Si el servidor lo RECHAZA no se puede dejar en la cola —se atascaría
       todo detrás— pero tirarlo en silencio es peor: el administrador llenó
       la visita en el sótano y desaparecería sin que nadie se entere.
       Se aparta con el motivo, y él decide.                              */
    if (r && !r.ok) {
      d.motivo = r.msg || 'el servidor lo rechazó sin explicar por qué';
      d.cuando = new Date().toISOString().slice(0, 16).replace('T', ' ');
      G.fallidos.push(d);
      guardar('fallidos', G.fallidos);
    }
    G.cola.shift();
    guardar('cola', G.cola);
    pintarCola();
    if (G.cola.length) setTimeout(sincronizar, 400);
  }).catch(function () { sincronizando = false; });
}


/* ══════════════ LOS TRES MÓDULOS ══════════════
   La bitácora es lo que se hace en el sótano. El requerimiento se escribe
   frente al equipo averiado —ahí es cuando se describe bien—, y los
   compromisos se consultan en la visita. Los tres, sin señal.        */

var PANEL = 'bit';
function irA(p) {
  PANEL = p;
  ['bit', 'req', 'cmp'].forEach(function (k) {
    el('pan_' + k).className = 'pan' + (k === p ? '' : ' oculto');
  });
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
    b.className = 'tab' + (b.getAttribute('data-p') === p ? ' on' : '');
  });
  window.scrollTo(0, 0);
  if (p === 'req' && !CAT_COMPRA) traerCatalogoCompra();
}

/* ── Requerimiento de compra ── */
var CAT_COMPRA = null;     // rubros, sistemas y tipos, del servidor
var ADJ_REQ = [];          // fotos y archivos en espera de este requerimiento

function traerCatalogoCompra(cb) {
  var g = leer('catcompra', null);
  if (g) { CAT_COMPRA = g; pintarCatalogoCompra(); if (cb) cb(); }
  if (!navigator.onLine) { if (!g) avisar('La primera vez necesitas conexión para cargar las listas.'); return; }
  api({ accion: 'catalogoCompra', token: G.token }).then(function (r) {
    if (!r.ok) return;
    CAT_COMPRA = r; guardar('catcompra', r); pintarCatalogoCompra(); if (cb) cb();
  }).catch(function () {});
}

function opciones(sel, lista, vacio) {
  var s = el(sel); if (!s) return;
  var antes = s.value;
  s.innerHTML = (vacio ? '<option value="">— ' + vacio + ' —</option>' : '')
    + (lista || []).map(function (x) { return '<option>' + x + '</option>'; }).join('');
  if (antes) s.value = antes;
}

function pintarCatalogoCompra() {
  if (!CAT_COMPRA) return;
  opciones('rq_ru', CAT_COMPRA.rubros);
  opciones('rq_si', CAT_COMPRA.sistemas, 'no aplica');
  opciones('rq_ur', CAT_COMPRA.urgencias);
  var t = el('rq_t');
  if (t && !t.options.length) {
    t.innerHTML = (CAT_COMPRA.tipos || []).map(function (x) {
      return '<option value="' + x.clave + '">' + x.titulo + '</option>';
    }).join('');
  }
  cambiaTipoReq();
}

/* Cada tipo tiene un dato sin el cual Procurement no puede cotizar. En el
   teléfono se pide ESE, no los siete del portal: una pantalla larga en la
   calle no se llena.                                                    */
var CLAVE_POR_TIPO = {
  bien:       { campo: 'marcaModelo',  et: 'Marca o modelo de referencia', ph: 'Pedrollo CP 620 o equivalente' },
  insumo:     { campo: 'presentacion', et: 'Presentación',                 ph: 'Galón · caja de 12 · saco de 25 kg' },
  recurrente: { campo: 'frecuencia',   et: 'Frecuencia',                   ph: 'Diaria · 3 veces por semana · mensual' },
  puntual:    { campo: 'alcance',      et: 'Alcance del trabajo',          ph: 'Qué hay que hacer exactamente' },
  obra:       { campo: 'area',         et: 'Área o metraje',               ph: '120 m² de pared · 40 m lineales' }
};

function cambiaTipoReq() {
  var t = v('rq_t') || 'bien';
  var c = CLAVE_POR_TIPO[t] || CLAVE_POR_TIPO.bien;
  el('rq_clavel').textContent = c.et;
  el('rq_clave').placeholder = c.ph;
  var pista = '';
  (((CAT_COMPRA || {}).tipos) || []).forEach(function (x) { if (x.clave === t) pista = x.pista; });
  el('rq_pista').textContent = pista;
}

function verOtroReq() {
  var ro = CAT_COMPRA ? CAT_COMPRA.rubroOtros : 'Otros';
  var so = CAT_COMPRA ? CAT_COMPRA.sistemaOtro : 'Otro';
  el('rq_otrow').className = (v('rq_ru') === ro) ? '' : 'oculto';
  el('rq_sisrow').className = (v('rq_si') === so) ? '' : 'oculto';
}

function adjuntarReq(esFoto) {
  pedirArchivo(esFoto, function (datos, tipo, nombre) {
    ADJ_REQ.push({ datos: datos, tipo: tipo, nombre: nombre });
    el('rq_adjn').textContent = ADJ_REQ.length + (ADJ_REQ.length === 1 ? ' adjunto' : ' adjuntos');
  });
}

/* Lo común de pedir un archivo: la cámara o el explorador, encoger si es
   imagen, y devolver los datos listos. Lo usan la bitácora y compras.  */
function pedirArchivo(esFoto, cb) {
  var inp = document.createElement('input');
  inp.type = 'file';
  if (esFoto) { inp.accept = 'image/*'; inp.capture = 'environment'; }
  else { inp.accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx'; }
  inp.onchange = function () {
    var f = inp.files && inp.files[0];
    if (!f) return;
    var esImagen = /^image\//.test(f.type);
    if (!esImagen && f.size > EVID_TOPE_DOC * 1048576) {
      avisar('Ese archivo pesa ' + (f.size / 1048576).toFixed(1) + ' MB y el tope son '
           + EVID_TOPE_DOC + ' MB. Las fotos se encogen solas.');
      return;
    }
    var listo = function (datos, tipo) {
      if (!datos) { avisar('No pude leer el archivo.'); return; }
      cb(datos, tipo, f.name || '');
    };
    if (esImagen) encogerFoto(f, listo); else leerTalCual(f, listo);
  };
  inp.click();
}

function enviarReq() {
  var ed = v('rq_e'), t = v('rq_t') || 'bien';
  if (!ed) { avisar('Elige el edificio.'); return; }
  if (v('rq_de').length < 12) { avisar('Escribe qué se necesita: qué es y para qué.', 'Falta el requerimiento'); return; }
  if (v('rq_pb').length < 15) { avisar('Cuenta qué pasa. Procurement cotiza distinto si falla a ratos o si ya no funciona.', 'Falta el porqué'); return; }
  var ro = CAT_COMPRA ? CAT_COMPRA.rubroOtros : 'Otros';
  var so = CAT_COMPRA ? CAT_COMPRA.sistemaOtro : 'Otro';
  if (v('rq_ru') === ro && !v('rq_ro')) { avisar('Elegiste Otros: escribe cuál.'); return; }
  if (v('rq_si') === so && !v('rq_so')) { avisar('Elegiste Otro: escribe qué sistema.'); return; }
  var c = CLAVE_POR_TIPO[t] || CLAVE_POR_TIPO.bien;
  if (!v('rq_clave')) { avisar('Falta ' + c.et.toLowerCase() + '. Sin eso no se puede cotizar.', 'Falta un dato'); return; }

  var d = {
    accion: 'requerimiento', tipo: t, edificio: ed,
    rubro: v('rq_ru'), rubroOtro: v('rq_ro'),
    sistema: v('rq_si'), sistemaOtro: v('rq_so'),
    cantidad: v('rq_ca'), urgencia: v('rq_ur'),
    requerimiento: v('rq_de'), problema: v('rq_pb'),
    especificaciones: v('rq_es'), montoEstimado: v('rq_me'),
    adjuntos: ADJ_REQ.slice()
  };
  d[c.campo] = v('rq_clave');

  var antes = G.cola.slice();
  G.cola.push(d);
  if (!guardar('cola', G.cola)) {
    G.cola = antes; guardar('cola', G.cola);
    avisar('No queda espacio en el teléfono. Conéctate para que se suba lo que tienes en cola.', 'Sin espacio');
    return;
  }
  ADJ_REQ = []; el('rq_adjn').textContent = '';
  ['rq_ca', 'rq_de', 'rq_pb', 'rq_clave', 'rq_es', 'rq_me', 'rq_ro', 'rq_so'].forEach(function (k) {
    var e = el(k); if (e) e.value = '';
  });
  el('rq_r').innerHTML = '<div class="aviso">Requerimiento en cola. '
    + (navigator.onLine ? 'Se está enviando a Procurement.' : 'Se enviará cuando vuelva la señal.') + '</div>';
  pintarCola();
  if (navigator.onLine) sincronizar();
}

function verRequerimientos() {
  var c = el('rq_lista');
  if (!navigator.onLine) { c.innerHTML = '<div class="aviso mal">Para consultar hace falta señal.</div>'; return; }
  c.innerHTML = '<p class="pista">Buscando...</p>';
  api({ accion: 'misRequerimientos', token: G.token, edificio: v('rq_e') }).then(function (r) {
    if (!r.ok) { c.innerHTML = '<div class="aviso mal">' + r.msg + '</div>'; return; }
    if (!r.n) { c.innerHTML = '<p class="pista">Todavía no hay requerimientos de este edificio.</p>'; return; }
    c.innerHTML = r.solicitudes.map(function (s) {
      return '<div class="cmp"><div class="cmpx"><b>' + s.num + '</b> · ' + s.estado + '</div>'
        + '<div class="cmpm">' + s.fecha + ' · ' + s.tipoTxt + (s.sistema ? (' · ' + s.sistema) : '') + '</div>'
        + '<div class="cmpm">' + s.requerimiento + '</div></div>';
    }).join('');
  }).catch(function () { c.innerHTML = '<div class="aviso mal">No se pudo consultar.</div>'; });
}

/* ── Compromisos ── */
function verCompromisos() {
  var c = el('cm_lista'), R = el('cm_res');
  if (!navigator.onLine) {
    var g = leer('compromisos', null);
    if (!g) { c.innerHTML = '<div class="aviso mal">Para verlos la primera vez hace falta señal.</div>'; return; }
    R.innerHTML = '<p class="pista">Sin señal: lo último que se descargó.</p>';
    pintarCompromisos(g); return;
  }
  c.innerHTML = '<p class="pista">Buscando...</p>'; R.innerHTML = '';
  api({ accion: 'compromisos', token: G.token,
        filtro: { q: v('cm_q'), edificio: v('cm_e') } }).then(function (r) {
    if (!r.ok) { c.innerHTML = '<div class="aviso mal">' + r.msg + '</div>'; return; }
    guardar('compromisos', r.compromisos || []);
    R.innerHTML = '<p class="pista">' + r.n + ' compromiso(s)'
      + (r.resumen && r.resumen.vencidos ? ' · ' + r.resumen.vencidos + ' vencidos' : '') + '</p>';
    pintarCompromisos(r.compromisos || []);
  }).catch(function () { c.innerHTML = '<div class="aviso mal">No se pudo consultar.</div>'; });
}

function pintarCompromisos(lista) {
  var c = el('cm_lista');
  if (!lista.length) { c.innerHTML = '<p class="pista">Ningún compromiso coincide.</p>'; return; }
  c.innerHTML = '';
  lista.forEach(function (x) {
    var d = document.createElement('div');
    d.className = 'cmp' + (x.vencido ? ' venc' : '');
    d.innerHTML = '<div class="cmpx">' + x.texto + '</div>'
      + '<div class="cmpm">' + x.edificio + (x.responsable ? (' · ' + x.responsable) : '')
      + ' · ' + (x.fecha || 'sin fecha') + ' · <b>' + x.estado + '</b></div>';
    if (x.estado !== 'Cumplido') {
      var b = document.createElement('div'); b.className = 'cmpb';
      [['Cumplido', '#1e7a3d'], ['En proceso', '#1B3A6B']].forEach(function (p) {
        var bt = document.createElement('button');
        bt.className = 'adjb'; bt.style.borderStyle = 'solid';
        bt.style.color = p[1]; bt.textContent = p[0];
        bt.onclick = function () { marcarComp(x.id, p[0]); };
        b.appendChild(bt);
      });
      d.appendChild(b);
    }
    c.appendChild(d);
  });
}

function marcarComp(id, estado) {
  encolar({ accion: 'marcarCompromiso', id: id, estado: estado });
  avisar(navigator.onLine ? 'Marcado como ' + estado + '.'
       : 'Marcado como ' + estado + '. Se enviará cuando vuelva la señal.');
  var g = leer('compromisos', []);
  g.forEach(function (x) { if (x.id === id) x.estado = estado; });
  guardar('compromisos', g);
  pintarCompromisos(g);
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
  G.fallidos = leer('fallidos', []);

  var us = leer('usuario', '');
  if (us && el('lg_u')) el('lg_u').value = us;

  if (G.token && G.nombre) {
    abrirApp();                                   // sin esperar a nadie
    if (navigator.onLine) descargarCatalogo(function (ok) {
      if (ok) { abrirApp(); bajarChecklists(); }
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
    b.onclick = function () { irA(b.getAttribute('data-p')); };
  });
  var enlazar = function (id, ev, fn) { var e = el(id); if (e) e[ev] = fn; };
  enlazar('rq_t',  'onchange', cambiaTipoReq);
  enlazar('rq_ru', 'onchange', verOtroReq);
  enlazar('rq_si', 'onchange', verOtroReq);
  enlazar('rq_foto', 'onclick', function () { adjuntarReq(true); });
  enlazar('rq_arch', 'onclick', function () { adjuntarReq(false); });
  enlazar('b_req', 'onclick', enviarReq);
  enlazar('b_verreq', 'onclick', verRequerimientos);
  enlazar('b_cmp', 'onclick', verCompromisos);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
