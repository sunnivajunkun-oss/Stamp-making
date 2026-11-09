'use strict';
(() => {
function wireEvents(root) {
  [root].concat(Array.from(root.querySelectorAll ? root.querySelectorAll('*') : [])).forEach(function(el) {
    ['click', 'input', 'change', 'blur', 'keydown', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'].forEach(function(event) {
      var fn = el['on' + event];
      if (typeof fn === 'function') {
        el['on' + event] = null;
        el.addEventListener(event, fn);
      }
    });
  });
}

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const state = {
  w: 500, h: 300, mode: 'single', border: 'stamp',
  stub: .3, stubColor: '#F3ECD6',
  paper: 0, paperColor: '#FFFFFF',
  zoom: 1, x: 0, y: 0, img: null,
  elements: [], selected: null
};

let nextId = 1, pendingFonts = 0, imageLoading = false, imageVersion = 0, exportBusy = false, preparedImage = null, albumBusy = false, lastFocus = null;
const fonts = window.STAMP_FONTS || [], fontCache = new Map(), pointers = new Map();
let gesture = null;
const names = { text: '文字', tear: '凹槽撕折线', perf: '打孔圆线', hole: '检票圆孔' };

function status(msg, error = false) {
  $('status').textContent = msg;
  $('status').classList.toggle('error', error);
}
function selected() { return state.elements.find(e => e.id === state.selected); }
function layout() {
  const pad = Math.min(state.paper, Math.floor(Math.min(state.w, state.h) * .2));
  const ih = state.h - 2 * pad, cw = state.w - 2 * pad;
  return { pad, ih, iw: cw * (state.mode === 'double' ? 1 - state.stub : 1) };
}
function imageWidth() { return layout().iw; }
function geometry() {
  const l = layout(), im = state.img;
  const base = im ? Math.max(l.iw / im.width, l.ih / im.height) : 1;
  return Object.assign({}, l, {
    scale: base * state.zoom,
    dw: im ? im.width * base * state.zoom : l.iw,
    dh: im ? im.height * base * state.zoom : l.ih
  });
}
function constrain() {
  const g = geometry();
  state.x = clamp(state.x, -Math.max(0, g.dw - g.iw) / 2, Math.max(0, g.dw - g.iw) / 2);
  state.y = clamp(state.y, -Math.max(0, g.dh - g.ih) / 2, Math.max(0, g.dh - g.ih) / 2);
}
function circle(c, x, y, r) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}
function rounded(c, w, h, r) {
  c.beginPath();
  c.moveTo(r, 0);
  c.arcTo(w, 0, w, h, r);
  c.arcTo(w, h, 0, h, r);
  c.arcTo(0, h, 0, 0, r);
  c.arcTo(0, 0, w, 0, r);
  c.closePath();
}

// 辅助：用奇偶环绕规则裁掉路径外部区域（用于向外鼓出的扇贝边、蕾丝边、锯齿边）
function eraseOutsidePath(c, w, h, traceInnerPath) {
  c.beginPath();
  c.rect(-40, -40, w + 80, h + 80);
  traceInnerPath(c, w, h);
  c.fill('evenodd');
}

// 升级版：四角自带独立转角圆花瓣 + 纯圆弧颗颗分明的扇贝/蕾丝路径
function traceScallopPath(c, w, h, r, targetStep) {
  const m = r * 1.15; // 内缩基准线，确保圆弧最高点刚好贴合画布边缘且绝不裁切
  const spanW = Math.max(20, w - 4 * m);
  const spanH = Math.max(20, h - 4 * m);
  const nx = Math.max(3, Math.round(spanW / targetStep));
  const ny = Math.max(3, Math.round(spanH / targetStep));
  const rx = spanW / (2 * nx);
  const ry = spanH / (2 * ny);
  const rc = (rx + ry) * 0.5;
  const holes = [];

  // 起点：左上角转角花瓣的右侧凹槽 (2m, m)
  c.moveTo(2 * m, m);

  // 1. 顶边波浪（从左到右，颗颗半圆弧）
  for (let i = 0; i < nx; i++) {
    const cx = 2 * m + (2 * i + 1) * rx;
    c.arc(cx, m, rx, Math.PI, 0, false);
    holes.push([cx, m * 0.95]);
  }
  // 右上角：独立转角花瓣（带左右深凹槽）
  c.quadraticCurveTo(w - m, m, w - m, 2 * m);
  holes.push([w - m * 1.05, m * 1.05]);

  // 2. 右边波浪（从上到下）
  for (let i = 0; i < ny; i++) {
    const cy = 2 * m + (2 * i + 1) * ry;
    c.arc(w - m, cy, ry, -Math.PI / 2, Math.PI / 2, false);
    holes.push([w - m * 0.95, cy]);
  }
  // 右下角：独立转角花瓣
  c.quadraticCurveTo(w - m, h - m, w - 2 * m, h - m);
  holes.push([w - m * 1.05, h - m * 1.05]);

  // 3. 底边波浪（从右到左）
  for (let i = nx - 1; i >= 0; i--) {
    const cx = 2 * m + (2 * i + 1) * rx;
    c.arc(cx, h - m, rx, 0, Math.PI, false);
    holes.push([cx, h - m * 0.95]);
  }
  // 左下角：独立转角花瓣
  c.quadraticCurveTo(m, h - m, m, h - 2 * m);
  holes.push([m * 1.05, h - m * 1.05]);

  // 4. 左边波浪（从下到上）
  for (let i = ny - 1; i >= 0; i--) {
    const cy = 2 * m + (2 * i + 1) * ry;
    c.arc(m, cy, ry, Math.PI / 2, -Math.PI / 2, false);
    holes.push([m * 0.95, cy]);
  }
  // 左上角：独立转角花瓣
  c.quadraticCurveTo(m, m, 2 * m, m);
  holes.push([m * 1.05, m * 1.05]);

  c.closePath();
  // 在四个角落补上真正鼓出的 45° 独立圆花瓣（通过圆心落在 (m,m) 处的圆弧）
  return { holes, m, rc };
}

// 专门绘制四角独立鼓出花瓣的增强版扇贝路径（100%纯圆弧不削顶 + 四角精准穿孔）
function tracePetalScallop(c, w, h, targetStep) {
  // Each corner is a 270-degree circle. Its cardinal endpoints are shared
  // exactly with the neighbouring scallops, avoiding implicit diagonal lines.
  const r = Math.min(targetStep / 2, Math.min(w, h) / 8);
  const m = r;
  const nx = Math.max(1, Math.ceil((w - 4 * r) / (2 * r)));
  const ny = Math.max(1, Math.ceil((h - 4 * r) / (2 * r)));
  const sx = (w - 4 * r) / nx, sy = (h - 4 * r) / ny;
  const holes = [], pi = Math.PI;
  c.moveTo(2 * r, m);
  for (let i = 0; i < nx; i++) {
    const x = 2 * r + (i + .5) * sx;
    c.arc(x, m, sx / 2, pi, 2 * pi, false);
    holes.push([x, m - sx * .11]);
  }
  c.arc(w - m, m, r, pi, 2.5 * pi, false);
  holes.push([w - m + r * .22, m - r * .22]);
  for (let i = 0; i < ny; i++) {
    const y = 2 * r + (i + .5) * sy;
    c.arc(w - m, y, sy / 2, -pi / 2, pi / 2, false);
    holes.push([w - m + sy * .11, y]);
  }
  c.arc(w - m, h - m, r, -pi / 2, pi, false);
  holes.push([w - m + r * .22, h - m + r * .22]);
  for (let i = nx - 1; i >= 0; i--) {
    const x = 2 * r + (i + .5) * sx;
    c.arc(x, h - m, sx / 2, 0, pi, false);
    holes.push([x, h - m + sx * .11]);
  }
  c.arc(m, h - m, r, 0, 1.5 * pi, false);
  holes.push([m - r * .22, h - m + r * .22]);
  for (let i = ny - 1; i >= 0; i--) {
    const y = 2 * r + (i + .5) * sy;
    c.arc(m, y, sy / 2, pi / 2, 1.5 * pi, false);
    holes.push([m - sy * .11, y]);
  }
  c.arc(m, m, r, pi / 2, 2 * pi, false);
  holes.push([m - r * .22, m - r * .22]);
  c.closePath();
  return holes;
}

// 升级版：四角带独立对角尖齿的复古锯齿路径（告别转角平塌粘连）
function traceZigzagPath(c, w, h, d, targetStep) {
  const cSpan = d * 0.9;
  const spanW = Math.max(24, w - 2 * (d + cSpan));
  const spanH = Math.max(24, h - 2 * (d + cSpan));
  const nx = Math.max(5, Math.round(spanW / targetStep));
  const ny = Math.max(5, Math.round(spanH / targetStep));
  const sx = spanW / nx;
  const sy = spanH / ny;

  c.moveTo(d + cSpan, d);
  // 顶边锯齿
  for (let i = 0; i < nx; i++) {
    c.lineTo(d + cSpan + (i + 0.5) * sx, 0);
    c.lineTo(d + cSpan + (i + 1) * sx, d);
  }
  // 右上角：独立对角尖齿
  c.lineTo(w - d * 0.15, d * 0.15);
  c.lineTo(w - d, d + cSpan);

  // 右边锯齿
  for (let i = 0; i < ny; i++) {
    c.lineTo(w, d + cSpan + (i + 0.5) * sy);
    c.lineTo(w - d, d + cSpan + (i + 1) * sy);
  }
  // 右下角：独立对角尖齿
  c.lineTo(w - d * 0.15, h - d * 0.15);
  c.lineTo(w - d - cSpan, h - d);

  // 底边锯齿
  for (let i = nx - 1; i >= 0; i--) {
    c.lineTo(d + cSpan + (i + 0.5) * sx, h);
    c.lineTo(d + cSpan + i * sx, h - d);
  }
  // 左下角：独立对角尖齿
  c.lineTo(d * 0.15, h - d * 0.15);
  c.lineTo(d, h - d - cSpan);

  // 左边锯齿
  for (let i = ny - 1; i >= 0; i--) {
    c.lineTo(0, d + cSpan + (i + 0.5) * sy);
    c.lineTo(d, d + cSpan + i * sy);
  }
  // 左上角：独立对角尖齿
  c.lineTo(d * 0.15, d * 0.15);
  c.lineTo(d + cSpan, d);
  c.closePath();
}

function fontSpec(e) {
  return `${e.size}px ${["serif", "sans-serif", "monospace"].includes(e.family) ? e.family : JSON.stringify(e.family)}, sans-serif`;
}
function textBounds(e) {
  const c = $('preview').getContext('2d');
  c.font = fontSpec(e);
  const lines = e.text.split('\n');
  if (e.vertical) {
    const cols = lines.map(s => Array.from(s));
    const maxRows = Math.max(1, ...cols.map(col => col.length));
    return { w: cols.length * e.size * 1.25 + 10, h: maxRows * e.size * 1.25 + 8 };
  }
  return { w: Math.max(20, ...lines.map(s => c.measureText(s).width)) + 10, h: lines.length * e.size * 1.25 + 8 };
}

function draw(canvas, mult = 1) {
  canvas.width = Math.round(state.w * mult);
  canvas.height = Math.round(state.h * mult);
  const c = canvas.getContext('2d');
  if (!c) throw Error('当前环境不支持 Canvas');
  c.scale(mult, mult);
  c.save();

  if (state.border === 'rounded') {
    rounded(c, state.w, state.h, Math.min(20, state.w / 4, state.h / 4));
    c.clip();
  }

  const g = geometry();
  if (g.pad > 0) {
    c.fillStyle = state.paperColor;
    c.fillRect(0, 0, state.w, state.h);
  }
  c.save();
  c.translate(g.pad, g.pad);
  c.beginPath();
  c.rect(0, 0, g.iw, g.ih);
  c.clip();

  if (state.img) {
    c.drawImage(state.img, (g.iw - g.dw) / 2 + state.x, (g.ih - g.dh) / 2 + state.y, g.dw, g.dh);
  } else {
    c.fillStyle = '#e9eddd';
    c.fillRect(0, 0, g.iw, g.ih);
    c.fillStyle = '#d2dbc0';
    circle(c, g.iw * .76, g.ih * .3, g.ih * .33);
    c.fillStyle = '#bbc9a8';
    c.beginPath();
    c.moveTo(0, g.ih * .83);
    c.quadraticCurveTo(g.iw * .3, g.ih * .35, g.iw * .6, g.ih * .77);
    c.quadraticCurveTo(g.iw * .85, g.ih * .98, g.iw, g.ih * .67);
    c.lineTo(g.iw, g.ih);
    c.lineTo(0, g.ih);
    c.fill();
    c.fillStyle = '#43533c';
    c.textAlign = 'center';
    c.font = `${Math.min(22, g.iw / 12)}px sans-serif`;
    c.fillText('放入照片，收藏这一刻', g.iw / 2, g.ih * .48);
  }
  c.restore();

  if (state.mode === 'double') {
    const split = g.pad + g.iw;
    c.fillStyle = state.stubColor;
    c.fillRect(split, g.pad, state.w - g.pad - split, g.ih);
    c.strokeStyle = 'rgba(116,119,101,0.3333)';
    c.lineWidth = 1;
    c.setLineDash([5, 5]);
    c.beginPath();
    c.moveTo(split, g.pad);
    c.lineTo(split, state.h - g.pad);
    c.stroke();
    c.setLineDash([]);
  }

  for (const e of state.elements) {
    if (e.type === 'text') {
      c.save();
      c.translate(e.x, e.y);
      c.rotate(e.rot * Math.PI / 180);
      c.font = fontSpec(e);
      c.fillStyle = e.color;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const lines = e.text.split('\n');
      if (e.vertical) {
        const cols = lines.map(s => Array.from(s));
        const maxRows = Math.max(1, ...cols.map(col => col.length));
        cols.forEach((chars, colIdx) => {
          const x = ((cols.length - 1) / 2 - colIdx) * e.size * 1.25;
          chars.forEach((ch, rowIdx) => {
            const y = (rowIdx - (maxRows - 1) / 2) * e.size * 1.25;
            c.fillText(ch, x, y);
          });
        });
      } else {
        lines.forEach((t, i) => c.fillText(t, 0, (i - (lines.length - 1) / 2) * e.size * 1.25));
      }
      c.restore();
    } else if (e.type === 'tear') {
      c.strokeStyle = '#777';
      c.lineWidth = 1.5;
      c.setLineDash([6, 4]);
      c.beginPath();
      c.moveTo(e.horizontal ? 0 : e.x, e.horizontal ? e.y : 0);
      c.lineTo(e.horizontal ? state.w : e.x, e.horizontal ? e.y : state.h);
      c.stroke();
      c.setLineDash([]);
    }
  }

  c.globalCompositeOperation = 'destination-out';
  c.fillStyle = 'black';

  // 8款边框花边绘制逻辑（含独立转角花瓣与独立尖齿）
  if (state.border === 'inverse-rounded') {
    [[0, 0], [state.w, 0], [0, state.h], [state.w, state.h]].forEach(([x, y]) => circle(c, x, y, 15));
  } else if (state.border === 'stamp') {
    for (let x = 7.5; x < state.w; x += 15) { circle(c, x, 0, 4.5); circle(c, x, state.h, 4.5); }
    for (let y = 7.5; y < state.h; y += 15) { circle(c, 0, y, 4.5); circle(c, state.w, y, 4.5); }
  } else if (state.border === 'scallop') {
    eraseOutsidePath(c, state.w, state.h, (ctx, w, h) => tracePetalScallop(ctx, w, h, 20));
  } else if (state.border === 'lace') {
    let holes = [];
    eraseOutsidePath(c, state.w, state.h, (ctx, w, h) => { holes = tracePetalScallop(ctx, w, h, 22); });
    holes.forEach(([hx, hy]) => circle(c, hx, hy, 2.2));
  } else if (state.border === 'zigzag') {
    eraseOutsidePath(c, state.w, state.h, (ctx, w, h) => traceZigzagPath(ctx, w, h, 7, 14));
  } else if (state.border === 'vintage') {
    const cr = 18;
    [[0, 0], [state.w, 0], [0, state.h], [state.w, state.h]].forEach(([x, y]) => circle(c, x, y, cr));
    const step = 24, r = 6.2;
    for (let x = cr + 14; x <= state.w - cr - 14; x += step) {
      circle(c, x, 0, r);
      circle(c, x, state.h, r);
    }
    for (let y = cr + 14; y <= state.h - cr - 14; y += step) {
      circle(c, 0, y, r);
      circle(c, state.w, y, r);
    }
  }

  for (const e of state.elements) {
    if (e.type === 'hole') circle(c, e.x, e.y, e.radius);
    if (e.type === 'tear') {
      if (e.horizontal) { circle(c, 0, e.y, 12); circle(c, state.w, e.y, 12); }
      else { circle(c, e.x, 0, 12); circle(c, e.x, state.h, 12); }
    }
    if (e.type === 'perf') {
      const length = e.horizontal ? state.w : state.h;
      for (let p = 7.5; p < length; p += 15) circle(c, e.horizontal ? p : e.x, e.horizontal ? e.y : p, 3);
    }
  }
  c.restore();
  return canvas;
}

function render() {
  state.paper = Math.min(state.paper, Math.floor(Math.min(state.w, state.h) * .2));
  $('paper-width').max = Math.min(80, Math.floor(Math.min(state.w, state.h) * .2));
  $('paper-width').value = state.paper;
  $('paper-width-value').textContent = state.paper + ' px';
  constrain();

  const stage = $('stage');
  const isMobile = window.innerWidth <= 760;
  const availableW = Math.max(50, stage.clientWidth - (isMobile ? 12 : 0));
  const availableH = Math.max(70, stage.clientHeight - (isMobile ? 12 : 40));
  const fit = Math.min(availableW / state.w, availableH / state.h, 1.5);

  const canvas = $('preview');
  canvas.style.width = state.w * fit + 'px';
  canvas.style.height = state.h * fit + 'px';
  draw(canvas, Math.min(2, window.devicePixelRatio || 1) * fit);

  $('dimensions').textContent = `${state.w} × ${state.h} px`;
  $('zoom').value = state.zoom;
  $('zoom-value').textContent = Math.round(state.zoom * 100) + '%';

  const e = selected(), box = $('selection');
  box.hidden = !e;
  if (e) {
    let b = e.type === 'text' ? textBounds(e) : e.type === 'hole' ? { w: e.radius * 2, h: e.radius * 2 } : e.horizontal ? { w: state.w, h: 16 } : { w: 16, h: state.h };
    let x = (e.type === 'perf' || e.type === 'tear') && e.horizontal ? state.w / 2 : e.x;
    let y = (e.type === 'perf' || e.type === 'tear') && !e.horizontal ? state.h / 2 : e.y;
    Object.assign(box.style, {
      left: (x - b.w / 2) * fit + 'px',
      top: (y - b.h / 2) * fit + 'px',
      width: b.w * fit + 'px',
      height: b.h * fit + 'px',
      transform: `rotate(${e.type === 'text' ? e.rot : 0}deg)`
    });
  }
}

function refreshList() {
  const list = $('element-list');
  while (list.firstChild) list.removeChild(list.firstChild);
  for (const e of state.elements) {
    const b = document.createElement('button');
    b.textContent = e.type === 'text' ? (e.text || '空文字') : names[e.type];
    b.className = e.id === state.selected ? 'active' : '';
    b.onclick = () => choose(e.id);
    wireEvents(b);
    list.append(b);
  }
}

function choose(id) {
  state.selected = id;
  const e = selected();
  $('image-mode').classList.toggle('active', !e);
  $('gesture-hint').textContent = e ? '拖动选中元素 · 使用面板旋转或删除' : '拖动图片调整构图 · 双指缩放';
  $('element-editor').hidden = !e;
  if (e) {
    showSection('elements');
    $('element-name').textContent = names[e.type];
    $('text-controls').hidden = e.type !== 'text';
    $('hole-size').hidden = e.type !== 'hole';
    $('rotate').hidden = e.type === 'hole';
		$('vertical').hidden = e.type !== 'text';
    if (e.type === 'text') {
      $('text').value = e.text;
      $('font').value = e.fontId;
      $('font-size').value = e.size;
      $('text-color').value = e.color;
			$('vertical').textContent = e.vertical ? '↔ 横排' : '↕ 竖排';
      $('vertical').classList.toggle('lilac', !!e.vertical);
			syncColor('text-color', e.color);
    }
  }
  refreshList();
  render();
}

function showSection(name) {
  document.querySelectorAll('[data-section]').forEach(b => b.setAttribute('aria-selected', b.dataset.section === name));
  $('section-layout').hidden = name !== 'layout';
  $('section-elements').hidden = name !== 'elements';
}

function resize(w, h) {
  const oldW = state.w, oldH = state.h;
  state.w = clamp(Math.round(Number(w) || oldW), 80, 2000);
  state.h = clamp(Math.round(Number(h) || oldH), 80, 2000);
  state.elements.forEach(e => { e.x *= state.w / oldW; e.y *= state.h / oldH; });
  state.x *= state.w / oldW;
  state.y *= state.h / oldH;
  $('width').value = state.w;
  $('height').value = state.h;
  if ($('width-range')) { $('width-range').value = state.w; $('width-value').textContent = state.w + ' px'; }
  if ($('height-range')) { $('height-range').value = state.h; $('height-value').textContent = state.h + ' px'; }
  render();
}

for (const id of ['width', 'height']) {
  $(id).addEventListener('change', () => resize($('width').value, $('height').value));
}
if ($('width-range')) {
  $('width-range').oninput = e => resize(e.target.value, state.h);
}
if ($('height-range')) {
  $('height-range').oninput = e => resize(state.w, e.target.value);
}

// 手机端底部半屏抽屉折叠/展开控制
if ($('drawer-toggle')) {
  let drawerState = 'normal';
  $('drawer-toggle').onclick = () => {
    const panel = $('control-panel');
    if (drawerState === 'normal') {
      drawerState = 'collapsed';
      panel.classList.add('drawer-collapsed');
      panel.classList.remove('drawer-expanded');
      $('drawer-toggle').textContent = '展开 ▴';
    } else {
      drawerState = 'normal';
      panel.classList.remove('drawer-collapsed', 'drawer-expanded');
      $('drawer-toggle').textContent = '收起 ▾';
    }
    setTimeout(render, 280);
  };
}

document.querySelectorAll('[data-size]').forEach(b => b.onclick = () => resize(...b.dataset.size.split(',')));
document.querySelectorAll('[data-section]').forEach(b => b.onclick = () => showSection(b.dataset.section));
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
  state.mode = b.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach(n => n.setAttribute('aria-pressed', n === b));
  $('stub-settings').hidden = state.mode !== 'double';
  render();
});
document.querySelectorAll('[data-border]').forEach(b => b.onclick = () => {
  state.border = b.dataset.border;
  document.querySelectorAll('[data-border]').forEach(n => n.setAttribute('aria-pressed', n === b));
  render();
});

$('paper-width').oninput = e => { state.paper = +e.target.value; render(); };
$('stub-ratio').oninput = e => { state.stub = e.target.value / 100; $('stub-value').textContent = e.target.value + '%'; render(); };
$('zoom').oninput = e => { state.zoom = +e.target.value; render(); };
$('reset-image').onclick = () => { state.zoom = 1; state.x = state.y = 0; render(); };
$('image-mode').onclick = () => choose(null);

$('image-upload').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  const version = ++imageVersion;
  imageLoading = true;
  status('正在读取照片…');
  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise((resolve, reject) => {
      const i = new Image();
      const timer = setTimeout(() => reject(Error('图片读取超时，请换一张 JPG 或 PNG')), 20000);
      i.onload = () => { clearTimeout(timer); resolve(i); };
      i.onerror = () => { clearTimeout(timer); reject(Error('无法读取此格式，请选择 JPG、PNG 或 WebP')); };
      i.src = url;
    });
    if (version !== imageVersion) return;
    state.img = im;
    state.zoom = 1;
    state.x = state.y = 0;
    choose(null);
    status('照片已就位，可以拖动调整构图');
  } catch (err) {
    if (version === imageVersion) status(err.message, true);
  } finally {
    URL.revokeObjectURL(url);
    if (version === imageVersion) imageLoading = false;
    e.target.value = '';
  }
};

function timeout(p, ms, message) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Error(message)), ms);
    Promise.resolve(p).then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}
async function loadFont(f) {
  if (!f) throw Error('找不到字体配置');
  if (!f.source) return f.family;
  if (typeof FontFace !== 'function' || !document.fonts) throw Error('当前环境不支持此字体，请使用系统字体');
  if (!fontCache.has(f.id)) {
    const task = (async () => {
      const face = new FontFace(f.family, `url(${JSON.stringify(f.source)})`, { weight: f.weight || 'normal' });
      await timeout(face.load(), 15000, '字体加载超时，请检查字体文件');
      document.fonts.add(face);
      return f.family;
    })();
    fontCache.set(f.id, task);
    task.catch(() => fontCache.delete(f.id));
  }
  return fontCache.get(f.id);
}
fonts.forEach(f => {
  const o = document.createElement('option');
  o.value = f.id;
  o.textContent = f.name;
  $('font').append(o);
});
$('font').onchange = async () => {
  const e = selected();
  if (!e || e.type !== 'text') return;
  const id = $('font').value, f = fonts.find(f => f.id === id), token = Symbol();
  e.fontRequest = token;
  pendingFonts++;
  $('font-status').textContent = '正在加载字体…';
  try {
    const family = await loadFont(f);
    if (e.fontRequest === token) {
      e.family = family;
      e.fontId = id;
      $('font-status').textContent = '字体已加载';
      render();
    }
  } catch (err) {
    if (e.fontRequest === token) {
      $('font').value = e.fontId;
      $('font-status').textContent = err.message;
      status('字体加载失败，保留原字体', true);
    }
  } finally {
    pendingFonts--;
  }
};

document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
  if (state.elements.length >= 50) { status('最多添加 50 个元素', true); return; }
  const type = b.dataset.add;
  const f = fonts[0] || { id: 'sans', family: 'sans-serif' };
  const e = {
    id: nextId++, type,
    x: type === 'text' ? layout().pad + imageWidth() / 2 : state.w * .7,
    y: state.h / 2, horizontal: false, rot: 0, radius: 10,
    text: '把这一刻寄给未来', size: 28, color: '#222222',
    fontId: f.id, family: f.family
  };
  state.elements.push(e);
  choose(e.id);
});

$('text').oninput = e => {
  const s = selected();
  if (s && s.type === 'text') { s.text = e.target.value; refreshList(); render(); }
};
$('font-size').onchange = e => {
  const s = selected();
  if (s) { s.size = clamp(+e.target.value || 28, 8, 200); e.target.value = s.size; render(); }
};
$('rotate').onclick = () => {
  const e = selected();
  if (!e) return;
  if (e.type === 'text') e.rot = (e.rot + 90) % 360;
  else e.horizontal = !e.horizontal;
  render();
};
$('vertical').onclick = () => {
  const e = selected();
  if (!e || e.type !== 'text') return;
  e.vertical = !e.vertical;
  $('vertical').textContent = e.vertical ? '↔ 横排' : '↕ 竖排';
  $('vertical').classList.toggle('lilac', e.vertical);
  render();
};
$('hole-size').onclick = () => {
  const e = selected();
  if (e) { e.radius = e.radius === 10 ? 20 : 10; render(); }
};
$('delete').onclick = () => {
  state.elements = state.elements.filter(e => e.id !== state.selected);
  choose(null);
};

function point(ev) {
  const r = $('preview').getBoundingClientRect();
  return { x: (ev.clientX - r.left) * state.w / r.width, y: (ev.clientY - r.top) * state.h / r.height };
}
function baseline() {
  const ps = [...pointers.values()];
  const e = selected();
  if (ps.length >= 2 && !e) {
    const a = ps[0], b = ps[1];
    gesture = { pinch: true, d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: state.zoom, x: state.x, y: state.y, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  } else if (ps.length) {
    gesture = { pinch: false, px: ps[0].x, py: ps[0].y, x: e ? e.x : state.x, y: e ? e.y : state.y, id: e ? e.id : null };
  } else gesture = null;
}

const cv = $('preview');
cv.onpointerdown = ev => {
  ev.preventDefault();
  cv.focus({ preventScroll: true });
  cv.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, point(ev));
  baseline();
};
cv.onpointermove = ev => {
  if (!pointers.has(ev.pointerId) || !gesture) return;
  ev.preventDefault();
  pointers.set(ev.pointerId, point(ev));
  const p = [...pointers.values()], g = gesture;
  if (g.pinch && p.length >= 2) {
    const z = clamp(g.z * Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) / g.d, 1, 5), q = z / g.z;
    state.zoom = z;
    state.x = (p[0].x + p[1].x) / 2 - (layout().pad + imageWidth() / 2) - (g.mx - (layout().pad + imageWidth() / 2) - g.x) * q;
    state.y = (p[0].y + p[1].y) / 2 - state.h / 2 - (g.my - state.h / 2 - g.y) * q;
  } else {
    const dx = p[0].x - g.px, dy = p[0].y - g.py, e = selected();
    if (e && e.id === g.id) {
      e.x = clamp(g.x + dx, 0, state.w);
      e.y = clamp(g.y + dy, 0, state.h);
    } else if (!e) {
      state.x = g.x + dx;
      state.y = g.y + dy;
    }
  }
  render();
};
function release(ev) { pointers.delete(ev.pointerId); baseline(); }
cv.onpointerup = release;
cv.onpointercancel = release;
cv.onlostpointercapture = release;

cv.onkeydown = ev => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete'].includes(ev.key)) return;
  ev.preventDefault();
  if (ev.key === 'Delete') { if (selected()) $('delete').click(); return; }
  const e = selected() || state, n = ev.shiftKey ? 10 : 1;
  e.x += ev.key === 'ArrowRight' ? n : ev.key === 'ArrowLeft' ? -n : 0;
  e.y += ev.key === 'ArrowDown' ? n : ev.key === 'ArrowUp' ? -n : 0;
  if (selected()) { e.x = clamp(e.x, 0, state.w); e.y = clamp(e.y, 0, state.h); }
  render();
};

function diagnostic(stage, err = '') {
  const text = [
    `Stamp making 网页通用版 | ${stage}`,
    `尺寸: ${state.w}×${state.h} / ${$('export-scale').value}x`,
    `边框: ${state.border}`,
    `照片: ${state.img ? '已读取' : '未上传'}`,
    `图片传递: ${preparedImage ? preparedImage.route : '浏览器直接下载'}`,
    `错误: ${err || '无'}`
  ].join('\n');
  $('diagnostics').textContent = text;
}

function downloadDataUrl(dataUrl, filename) {
  const parts = dataUrl.split(',');
  const mime = (parts[0].match(/:(.*?);/) || [null, 'image/png'])[1];
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  const blob = new Blob([u8arr], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function generate() {
  if (exportBusy || albumBusy) return;
  if (imageLoading || pendingFonts) { status('图片或字体仍在加载，请稍后生成', true); return; }
  if (!state.img) { status('请先放入一张照片', true); $('image-upload').click(); return; }
  exportBusy = true;
  preparedImage = null;
  $('save-album').disabled = true;
  status('正在生成 PNG…');
  $('export').disabled = $('export-top').disabled = true;
  try {
    await new Promise(r => requestAnimationFrame(r));
    const mult = +$('export-scale').value;
    if (state.w * state.h * mult * mult > 16000000) throw Error('图片过大，请选择 1× 或 2× 导出');
    const canvas = draw(document.createElement('canvas'), mult);
    const data = canvas.toDataURL('image/png');
    if (data === 'data:,') throw Error('当前设备无法生成此尺寸，请降低倍率');
    const size = Math.floor((data.length - data.indexOf(',') - 1) * .75);
    $('result').src = data;
    canvas.width = canvas.height = 1;
    $('result-info').textContent = `${state.w * mult} × ${state.h * mult} px · 透明 PNG · ${(size / 1024).toFixed(0)} KB`;
    lastFocus = document.activeElement;
    $('export-dialog').hidden = false;
    document.body.style.overflow = 'hidden';
    $('close-export').focus();
    preparedImage = { filePath: data, route: '浏览器下载', version: 'Web' };
    $('save-album').disabled = false;
    $('save-status').textContent = '点击下方按钮直接下载图片（手机端也可长按上方图片保存到相册）。';
    diagnostic('准备就绪');
    status('PNG 已生成，请在成品面板保存');
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    status('生成失败：' + msg, true);
    diagnostic('生成失败', msg);
  } finally {
    exportBusy = false;
    $('export').disabled = $('export-top').disabled = false;
  }
}
$('export').onclick = generate;
$('export-top').onclick = generate;

$('save-album').onclick = async () => {
  if (albumBusy || !preparedImage) return;
  albumBusy = true;
  $('save-album').disabled = true;
  $('close-export').disabled = true;
  try {
    downloadDataUrl(preparedImage.filePath, `stamp-${Date.now()}.png`);
    $('save-status').textContent = '已触发浏览器下载！手机端若未自动存入相册，可直接长按上方预览图选择“存储到“照片”/保存图片”。';
    diagnostic('浏览器下载已触发');
  } catch (err) {
    const reason = err && err.message ? err.message : String(err);
    $('save-status').textContent = '下载未完成：' + reason + '。请直接长按或右键上方图片保存。';
    diagnostic('保存失败', reason);
  } finally {
    albumBusy = false;
    $('save-album').disabled = false;
    $('close-export').disabled = false;
  }
};

function close() {
  if (albumBusy || exportBusy) return;
  $('export-dialog').hidden = true;
  document.body.style.overflow = '';
  if (lastFocus) lastFocus.focus();
}
$('close-export').onclick = close;
$('export-dialog').onclick = e => { if (e.target === $('export-dialog')) close(); };
document.addEventListener('keydown', e => {
  if ($('export-dialog').hidden) return;
  if (e.key === 'Escape') close();
});

// ==================== 一个木函同款：同心圆点矩阵取色器 ====================
const colorWidgets = new Map();

function normalizeHex(value) {
  let v = String(value || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(v)) v = v.split('').map(x => x + x).join('');
  return /^[0-9a-f]{6}$/i.test(v) ? '#' + v.toUpperCase() : null;
}

function hsvToHex(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const toHex = n => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return ('#' + toHex(r) + toHex(g) + toHex(b)).toUpperCase();
}

function isLightColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 0.299 + g * 0.587 + b * 0.114) > 155;
}

function buildWheelDots(size, brightness) {
  const cx = size / 2, cy = size / 2, maxR = size / 2 - 11;
  const rings = 7;
  const dots = [{ x: cx, y: cy, r: 5.5, h: 0, s: 0, color: hsvToHex(0, 0, brightness) }];
  for (let ring = 1; ring <= rings; ring++) {
    const count = ring * 6;
    const radius = (ring / rings) * maxR;
    const s = ring / rings;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      const h = ((i / count) * 360 + 360) % 360;
      dots.push({
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        r: 4.8 + (ring / rings) * 1.5,
        h, s,
        color: hsvToHex(h, s, brightness)
      });
    }
  }
  return dots;
}

function syncColor(id, value) {
  const w = colorWidgets.get(id);
  if (!w) return;
  const hex = normalizeHex(value);
  if (!hex) return;
  $(id).value = hex;
  w.triggerDot.style.background = hex;
  w.triggerText.textContent = hex;
  w.banner.style.background = hex;
  w.banner.style.color = isLightColor(hex) ? '#20211f' : '#ffffff';
  w.hexInput.value = hex;
  w.note.textContent = '';
  w.swatches.forEach(b => b.setAttribute('aria-pressed', b.dataset.color === hex));
  w.drawWheel(hex);
}

function setupColor(id, label, apply) {
  const picker = $(id);
  const triggerBtn = document.createElement('button');
  triggerBtn.type = 'button';
  triggerBtn.className = 'color-trigger-btn';
  const triggerDot = document.createElement('span');
  triggerDot.className = 'color-trigger-dot';
  const triggerText = document.createElement('span');
  const triggerArrow = document.createElement('span');
  triggerArrow.textContent = '▾';
  triggerBtn.append(triggerDot, triggerText, triggerArrow);
  picker.insertAdjacentElement('afterend', triggerBtn);

  const root = document.createElement('div');
  root.className = 'color-controls';
  root.hidden = true;

  const swatchesBar = document.createElement('div');
  swatchesBar.className = 'swatches-bar';
  const palette = document.createElement('div');
  palette.className = 'swatches';
  const swatches = ['#FFFFFF', '#F3ECD6', '#E9E0FA', '#EFD4D4', '#C8E6CD', '#DCEBFA', '#222222'].map(color => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.color = color;
    b.style.background = color;
    b.setAttribute('aria-label', label + ' ' + color);
    b.onclick = () => { activeDotIndex = -1; commit(color); };
    wireEvents(b);
    palette.append(b);
    return b;
  });
  swatchesBar.append(palette);
  root.append(swatchesBar);

  const banner = document.createElement('div');
  banner.className = 'muhan-banner';
  const hexInput = document.createElement('input');
  hexInput.type = 'text';
  hexInput.className = 'muhan-hex-input';
  hexInput.maxLength = 7;
  hexInput.spellcheck = false;
  hexInput.setAttribute('aria-label', label + ' HEX');
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'muhan-copy-btn';
  copyBtn.textContent = '复制';
  copyBtn.onclick = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(hexInput.value);
    copyBtn.textContent = '已复制';
    setTimeout(() => copyBtn.textContent = '复制', 1200);
  };
  banner.append(hexInput, copyBtn);
  root.append(banner);

  const wheelWrap = document.createElement('div');
  wheelWrap.className = 'muhan-wheel-wrap';
  const wheelCanvas = document.createElement('canvas');
  wheelCanvas.className = 'muhan-wheel';
  const wheelSize = 236;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  wheelCanvas.width = wheelSize * dpr;
  wheelCanvas.height = wheelSize * dpr;
  wheelWrap.append(wheelCanvas);
  root.append(wheelWrap);

  const brightRow = document.createElement('label');
  brightRow.className = 'muhan-brightness';
  brightRow.innerHTML = '<span>☀ 明亮度</span>';
  const brightSlider = document.createElement('input');
  brightSlider.type = 'range';
  brightSlider.min = '20';
  brightSlider.max = '100';
  brightSlider.value = '100';
  brightRow.append(brightSlider);
  root.append(brightRow);

  const note = document.createElement('p');
  note.className = 'color-feedback';
  note.setAttribute('role', 'status');
  root.append(note);

  picker.closest('.field-heading,.color-title,.text-options').insertAdjacentElement('afterend', root);

  let brightness = 1;
  let dots = buildWheelDots(wheelSize, brightness);
  let activeDotIndex = -1;

  function drawWheel(currentHex) {
    const ctx = wheelCanvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, wheelSize, wheelSize);
    dots.forEach((d, idx) => {
      if (idx === activeDotIndex || d.color === currentHex) return;
      ctx.fillStyle = d.color;
      circle(ctx, d.x, d.y, d.r);
    });
    const selIdx = activeDotIndex >= 0 ? activeDotIndex : dots.findIndex(d => d.color === currentHex);
    if (selIdx >= 0 && dots[selIdx]) {
      const d = dots[selIdx];
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.22)';
      ctx.shadowBlur = 8;
      ctx.fillStyle = d.color;
      circle(ctx, d.x, d.y, d.r * 2.1);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function pickFromWheel(ev) {
    const rect = wheelCanvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (wheelSize / rect.width);
    const y = (ev.clientY - rect.top) * (wheelSize / rect.height);
    let bestIdx = -1, bestDist = 999;
    dots.forEach((d, idx) => {
      const dist = Math.hypot(x - d.x, y - d.y);
      if (dist < bestDist) { bestDist = dist; bestIdx = idx; }
    });
    if (bestIdx >= 0 && bestDist <= 18) {
      activeDotIndex = bestIdx;
      commit(dots[bestIdx].color);
    }
  }

  let wheelDragging = false;
  wheelCanvas.onpointerdown = ev => {
    ev.preventDefault();
    wheelDragging = true;
    wheelCanvas.setPointerCapture(ev.pointerId);
    pickFromWheel(ev);
  };
  wheelCanvas.onpointermove = ev => {
    if (!wheelDragging) return;
    ev.preventDefault();
    pickFromWheel(ev);
  };
  wheelCanvas.onpointerup = wheelCanvas.onpointercancel = () => { wheelDragging = false; };

  brightSlider.oninput = () => {
    brightness = +brightSlider.value / 100;
    dots = buildWheelDots(wheelSize, brightness);
    if (activeDotIndex >= 0 && dots[activeDotIndex]) {
      commit(dots[activeDotIndex].color);
    } else {
      drawWheel($(id).value);
    }
  };

  triggerBtn.onclick = () => {
    root.hidden = !root.hidden;
    triggerArrow.textContent = root.hidden ? '▾' : '▴';
    if (!root.hidden) drawWheel($(id).value);
  };

  function commit(color) {
    syncColor(id, color);
    apply(color);
    render();
  }

  hexInput.oninput = () => {
    const color = normalizeHex(hexInput.value);
    if (color) {
      activeDotIndex = -1;
      const typed = hexInput.value;
      commit(color);
      hexInput.value = typed;
    } else {
      note.textContent = '请输入 3 或 6 位色号，如 #F3ECD6';
    }
  };
  hexInput.onchange = () => {
    const color = normalizeHex(hexInput.value);
    if (color) commit(color);
  };

  colorWidgets.set(id, { triggerDot, triggerText, banner, hexInput, note, swatches, drawWheel });
  syncColor(id, picker.value);
  wireEvents(root);
  wireEvents(triggerBtn);
}

setupColor('stub-color', '副券', color => state.stubColor = color);
setupColor('paper-color', '纸边', color => state.paperColor = color);
setupColor('text-color', '文字', color => { const e = selected(); if (e) e.color = color; });

wireEvents(document.body);
window.addEventListener('resize', render);
if (typeof ResizeObserver === 'function') new ResizeObserver(render).observe($('stage'));
requestAnimationFrame(render);
})();