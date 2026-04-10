/* ─── 气泡标注工具 v2 ─── */

const API_BASE = ''; // nginx 反代，使用相对路径
const CONFIG_KEY = 'bubble_cfg_v2';

// ── 类型颜色映射 ──────────────────────────────────────────────────────────────
const TYPE_COLORS = {
  '直径':  '#3498db', '半径': '#9b59b6', '尺寸': '#e67e22',
  '角度':  '#2ecc71', '粗糙度': '#1abc9c', '其他': '#607d8b',
};
function typeColor(t) { return TYPE_COLORS[t] || '#607d8b'; }

// ── 状态 ──────────────────────────────────────────────────────────────────────
const state = {
  annotations: [],   // { id, num, x, y, value, upper_tol, lower_tol, type, color, remark }
  nextNum: 1,
  zoom: 1,
  imgW: 0, imgH: 0,
  viewMode: 'bubble',   // 'original' | 'bubble'
  showBubbles: true,
  showValues: true,
  showBorders: true,
  addMode: false,
  manualNumMode: false,
  dragging: null,
  selectedId: null,
  workflowStep: 0,      // 0-4
  style: { bubbleR: 17, fontSize: 13, opacity: 92, showLeader: true },
};

function loadConfig() { try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'); } catch { return {}; } }
function saveConfig(c) { localStorage.setItem(CONFIG_KEY, JSON.stringify(c)); }

// ── DOM ───────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fileInput     = $('file-input');
const drawingImg    = $('drawing-img');
const bubbleSvg     = $('bubble-svg');
const canvasWrap    = $('canvas-wrap');
const dropHint      = $('drop-hint');
const zoomLabel     = $('zoom-label');
const annTbody      = $('ann-tbody');
const totalCount    = $('total-count');
const numberedCount = $('numbered-count');
const fileName      = $('file-name');
const aiOverlay     = $('ai-overlay');
const aiStatus      = $('ai-status');
const convOverlay   = $('conv-overlay');
const convStatus    = $('conv-status');

// ── 工作流步骤 ────────────────────────────────────────────────────────────────
function setWorkflowStep(step) {
  state.workflowStep = step;
  for (let i = 0; i <= 4; i++) {
    const el = $(`ws-${i}`);
    el.classList.remove('done', 'active', 'loading');
    if (i < step) el.classList.add('done');
    else if (i === step) el.classList.add('active');
  }
}
setWorkflowStep(0);

// ── 文件加载 ──────────────────────────────────────────────────────────────────
const CAD_EXTS = ['.dxf', '.dwg', '.svg'];
const getExt = f => '.' + f.name.split('.').pop().toLowerCase();

function onImageReady() {
  state.imgW = drawingImg.naturalWidth;
  state.imgH = drawingImg.naturalHeight;
  dropHint.classList.add('hidden');
  drawingImg.classList.remove('hidden');
  $('btn-ai-analyze').disabled = false;
  $('btn-manual-num').disabled = false;
  applyZoom();
  render();
  setWorkflowStep(1);
}

function loadImageSrc(src) {
  drawingImg.onload = onImageReady;
  drawingImg.src = src;
}

function loadImageFile(file) {
  if (!file) return;
  fileName.textContent = file.name;
  const ext = getExt(file);

  if (file.type === 'application/pdf') { loadPDF(file); return; }
  if (CAD_EXTS.includes(ext)) { loadCAD(file); return; }
  loadImageSrc(URL.createObjectURL(file));
}

function loadPDF(file) {
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  s.onload = () => {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const url = URL.createObjectURL(file);
    pdfjsLib.getDocument(url).promise
      .then(pdf => pdf.getPage(1))
      .then(page => {
        const vp = page.getViewport({ scale: 2 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
          .then(() => loadImageSrc(c.toDataURL()));
      });
  };
  document.head.appendChild(s);
}

async function loadCAD(file) {
  convStatus.textContent = `正在转换 ${file.name}…`;
  convOverlay.hidden = false;
  try {
    const fd = new FormData();
    fd.append('file', file);
    const resp = await fetch(`${API_BASE}/api/convert`, { method: 'POST', body: fd });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    loadImageSrc(data.image);
  } catch (e) {
    alert(`CAD 转换失败：${e.message}`);
  } finally {
    convOverlay.hidden = true;
  }
}

fileInput.addEventListener('change', e => loadImageFile(e.target.files[0]));
canvasWrap.addEventListener('dragover', e => { e.preventDefault(); canvasWrap.classList.add('dragover'); });
canvasWrap.addEventListener('dragleave', () => canvasWrap.classList.remove('dragover'));
canvasWrap.addEventListener('drop', e => {
  e.preventDefault();
  canvasWrap.classList.remove('dragover');
  loadImageFile(e.dataTransfer.files[0]);
});

// ── 缩放 ──────────────────────────────────────────────────────────────────────
function setZoom(z) {
  state.zoom = Math.min(3, Math.max(0.1, z));
  zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
  applyZoom();
}
function applyZoom() {
  const z = state.zoom;
  drawingImg.style.width  = state.imgW * z + 'px';
  drawingImg.style.height = state.imgH * z + 'px';
  bubbleSvg.style.width   = state.imgW * z + 'px';
  bubbleSvg.style.height  = state.imgH * z + 'px';
  bubbleSvg.setAttribute('viewBox', `0 0 ${state.imgW} ${state.imgH}`);
  render();
}

$('btn-zoom-out').addEventListener('click', () => setZoom(state.zoom - 0.1));
$('btn-zoom-in').addEventListener('click',  () => setZoom(state.zoom + 0.1));
$('btn-zoom-fit').addEventListener('click', () => {
  if (!state.imgW) return;
  const wrap = canvasWrap.getBoundingClientRect();
  const z = Math.min((wrap.width - 48) / state.imgW, (wrap.height - 48) / state.imgH);
  setZoom(z);
});
canvasWrap.addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  setZoom(state.zoom + (e.deltaY > 0 ? -0.05 : 0.05));
}, { passive: false });

// ── 视图 & 图层 ───────────────────────────────────────────────────────────────
$('tab-original').addEventListener('click', () => {
  state.viewMode = 'original';
  $('tab-original').classList.add('active'); $('tab-bubble').classList.remove('active');
  render();
});
$('tab-bubble').addEventListener('click', () => {
  state.viewMode = 'bubble';
  $('tab-bubble').classList.add('active'); $('tab-original').classList.remove('active');
  render();
});
$('show-bubbles').addEventListener('change', e => { state.showBubbles = e.target.checked; render(); });
$('show-values').addEventListener('change',  e => { state.showValues  = e.target.checked; render(); });
$('show-borders').addEventListener('change', e => { state.showBorders = e.target.checked; render(); });

// ── 手动添加模式（点击图纸添加气泡）─────────────────────────────────────────
$('btn-add-one').addEventListener('click', () => toggleAddMode());

function toggleAddMode(force) {
  state.addMode = force !== undefined ? force : !state.addMode;
  state.manualNumMode = false;
  $('btn-manual-num').classList.remove('active');
  bubbleSvg.classList.toggle('add-mode', state.addMode);
  bubbleSvg.classList.remove('num-mode');
}

// ── 自主编号模式 ──────────────────────────────────────────────────────────────
$('btn-manual-num').addEventListener('click', () => {
  state.manualNumMode = !state.manualNumMode;
  state.addMode = false;
  toggleAddMode(false);
  $('btn-manual-num').classList.toggle('active', state.manualNumMode);
  bubbleSvg.classList.toggle('num-mode', state.manualNumMode);
});

// SVG 点击 → 添加气泡
bubbleSvg.addEventListener('click', e => {
  if (!state.addMode && !state.manualNumMode) return;
  if (e.target !== bubbleSvg) return;
  const rect = bubbleSvg.getBoundingClientRect();
  const x = (e.clientX - rect.left) / state.zoom;
  const y = (e.clientY - rect.top)  / state.zoom;
  addAnnotation(x, y);
});

function addAnnotation(x, y, fields = {}) {
  const ann = {
    id: Date.now() + Math.random(),
    num: state.nextNum++,
    x, y,
    value:     fields.value     || '',
    upper_tol: fields.upper_tol || '',
    lower_tol: fields.lower_tol || '',
    type:      fields.type      || '尺寸',
    color:     fields.color     || typeColor(fields.type || '尺寸'),
    remark:    fields.remark    || '',
  };
  state.annotations.push(ann);
  render();
  renderTable();
  return ann;
}

// ── 渲染画布 ──────────────────────────────────────────────────────────────────
function render() {
  bubbleSvg.innerHTML = '';
  if (state.viewMode === 'original') return;

  const r  = state.style.bubbleR;
  const fs = state.style.fontSize;
  const op = state.style.opacity / 100;

  for (const ann of state.annotations) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `bubble-group${ann.id === state.selectedId ? ' highlight' : ''}`);
    g.setAttribute('data-id', ann.id);

    // 引导线（从气泡右下角延伸一小段）
    if (state.style.showLeader && state.showBubbles) {
      const line = svgEl('line');
      line.setAttribute('class', 'bubble-leader');
      line.setAttribute('x1', ann.x + r * 0.7);
      line.setAttribute('y1', ann.y + r * 0.7);
      line.setAttribute('x2', ann.x + r * 1.6);
      line.setAttribute('y2', ann.y + r * 1.6);
      line.setAttribute('stroke', ann.color);
      g.appendChild(line);
    }

    // 气泡圆
    if (state.showBubbles) {
      const circle = svgEl('circle');
      circle.setAttribute('class', 'bubble-circle');
      circle.setAttribute('cx', ann.x); circle.setAttribute('cy', ann.y);
      circle.setAttribute('r', r);
      circle.setAttribute('fill', ann.color);
      circle.setAttribute('fill-opacity', op);
      circle.setAttribute('stroke', '#fff');
      g.appendChild(circle);

      const num = svgEl('text');
      num.setAttribute('class', 'bubble-num');
      num.setAttribute('x', ann.x); num.setAttribute('y', ann.y);
      num.setAttribute('font-size', fs);
      num.textContent = ann.num;
      g.appendChild(num);
    }

    // 尺寸标签
    if (state.showValues && ann.value) {
      const displayVal = ann.value + (ann.upper_tol ? ` ${ann.upper_tol}` : '') + (ann.lower_tol ? `/${ann.lower_tol}` : '');
      const lw = Math.max(displayVal.length * 6.5 + 12, 48);
      const lh = 18;
      const lx = ann.x - lw / 2;
      const ly = ann.y + r + 4;

      if (state.showBorders) {
        const rect = svgEl('rect');
        rect.setAttribute('class', 'bubble-value-rect');
        rect.setAttribute('x', lx); rect.setAttribute('y', ly);
        rect.setAttribute('width', lw); rect.setAttribute('height', lh);
        rect.setAttribute('fill', ann.color);
        rect.setAttribute('fill-opacity', '0.82');
        g.appendChild(rect);
      }

      const txt = svgEl('text');
      txt.setAttribute('class', 'bubble-value-text');
      txt.setAttribute('x', ann.x); txt.setAttribute('y', ly + lh / 2);
      txt.setAttribute('font-size', fs - 2);
      txt.textContent = displayVal.length > 22 ? displayVal.slice(0, 22) + '…' : displayVal;
      g.appendChild(txt);
    }

    bindBubble(g, ann.id);
    bubbleSvg.appendChild(g);
  }
}

function svgEl(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }

// ── 气泡拖拽 & 双击 ───────────────────────────────────────────────────────────
function bindBubble(g, id) {
  g.addEventListener('mousedown', e => {
    if (state.addMode || state.manualNumMode) return;
    e.stopPropagation();
    const ann = state.annotations.find(a => a.id === id);
    state.dragging = { id, startX: e.clientX, startY: e.clientY, origX: ann.x, origY: ann.y };
    selectAnnotation(id);
  });
  g.addEventListener('dblclick', e => { e.stopPropagation(); openEditModal(id); });
}

document.addEventListener('mousemove', e => {
  if (!state.dragging) return;
  const ann = state.annotations.find(a => a.id === state.dragging.id);
  if (!ann) return;
  ann.x = state.dragging.origX + (e.clientX - state.dragging.startX) / state.zoom;
  ann.y = state.dragging.origY + (e.clientY - state.dragging.startY) / state.zoom;
  render();
});
document.addEventListener('mouseup', () => { state.dragging = null; });

// ── 选中标注 ──────────────────────────────────────────────────────────────────
function selectAnnotation(id) {
  state.selectedId = id;
  render();
  // 高亮表格行
  document.querySelectorAll('#ann-tbody tr').forEach(tr => {
    tr.classList.toggle('selected', tr.dataset.id == id);
  });
}

// ── 标注表格 ──────────────────────────────────────────────────────────────────
function renderTable() {
  annTbody.innerHTML = '';
  state.annotations.forEach((ann, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.id = ann.id;
    if (ann.id === state.selectedId) tr.classList.add('selected');
    tr.innerHTML = `
      <td class="num-cell" style="color:${ann.color}">${ann.num}</td>
      <td>${ann.value || '<span style="color:#555">—</span>'}</td>
      <td class="tol-cell">${ann.upper_tol || ''}</td>
      <td class="tol-cell neg">${ann.lower_tol || ''}</td>
      <td><span class="type-tag">${ann.type}</span></td>
      <td>
        <div class="move-btns">
          <button class="move-btn" data-dir="up" data-idx="${idx}">▲</button>
          <button class="move-btn" data-dir="down" data-idx="${idx}">▼</button>
        </div>
      </td>
    `;
    tr.addEventListener('click', () => { selectAnnotation(ann.id); });
    tr.addEventListener('dblclick', () => openEditModal(ann.id));
    annTbody.appendChild(tr);
  });

  // 上下移动
  annTbody.querySelectorAll('.move-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = +btn.dataset.idx;
      const dir = btn.dataset.dir;
      const arr = state.annotations;
      if (dir === 'up' && idx > 0) [arr[idx-1], arr[idx]] = [arr[idx], arr[idx-1]];
      if (dir === 'down' && idx < arr.length-1) [arr[idx], arr[idx+1]] = [arr[idx+1], arr[idx]];
      renderTable(); render();
    });
  });

  totalCount.textContent = state.annotations.length;
  numberedCount.textContent = state.annotations.length;
}

// ── 编辑弹窗 ──────────────────────────────────────────────────────────────────
function openEditModal(id) {
  const ann = state.annotations.find(a => a.id === id);
  if (!ann) return;
  state.selectedId = id;
  $('edit-num-label').textContent = `#${ann.num}`;
  $('edit-value').value  = ann.value;
  $('edit-upper').value  = ann.upper_tol;
  $('edit-lower').value  = ann.lower_tol;
  $('edit-type').value   = ann.type;
  $('edit-color').value  = ann.color;
  $('edit-remark').value = ann.remark || '';
  $('edit-overlay').hidden = false;
}

$('edit-cancel').addEventListener('click', () => { $('edit-overlay').hidden = true; });
$('edit-overlay').addEventListener('click', e => { if (e.target === $('edit-overlay')) $('edit-overlay').hidden = true; });

$('edit-save').addEventListener('click', () => {
  const ann = state.annotations.find(a => a.id === state.selectedId);
  if (ann) {
    ann.value     = $('edit-value').value.trim();
    ann.upper_tol = $('edit-upper').value.trim();
    ann.lower_tol = $('edit-lower').value.trim();
    ann.type      = $('edit-type').value;
    ann.color     = $('edit-color').value;
    ann.remark    = $('edit-remark').value.trim();
  }
  $('edit-overlay').hidden = true;
  render(); renderTable();
});

$('edit-delete').addEventListener('click', () => {
  state.annotations = state.annotations.filter(a => a.id !== state.selectedId);
  state.selectedId = null;
  $('edit-overlay').hidden = true;
  render(); renderTable();
});

// ── 底部操作按钮 ──────────────────────────────────────────────────────────────
$('btn-edit-sel').addEventListener('click', () => { if (state.selectedId) openEditModal(state.selectedId); });

$('btn-del-sel').addEventListener('click', () => {
  if (!state.selectedId) return;
  state.annotations = state.annotations.filter(a => a.id !== state.selectedId);
  state.selectedId = null;
  render(); renderTable();
});

$('btn-clear-all').addEventListener('click', () => {
  if (!state.annotations.length) return;
  if (!confirm('确认清空所有标注？')) return;
  state.annotations = []; state.nextNum = 1; state.selectedId = null;
  render(); renderTable(); setWorkflowStep(state.imgW ? 1 : 0);
});

// 重新编号
$('btn-refresh-num').addEventListener('click', () => {
  state.annotations.forEach((a, i) => a.num = i + 1);
  state.nextNum = state.annotations.length + 1;
  render(); renderTable();
});

// 按编号排序
$('btn-sort-num').addEventListener('click', () => {
  state.annotations.sort((a, b) => a.num - b.num);
  renderTable(); render();
});

// 删除选中（header 快捷）
$('btn-delete-selected').addEventListener('click', () => {
  if (!state.selectedId) return;
  state.annotations = state.annotations.filter(a => a.id !== state.selectedId);
  state.selectedId = null;
  render(); renderTable();
});

// ── 样式设置 ──────────────────────────────────────────────────────────────────
$('btn-style').addEventListener('click', () => {
  $('sty-size').value    = state.style.bubbleR;
  $('sty-font').value    = state.style.fontSize;
  $('sty-opacity').value = state.style.opacity;
  $('sty-leader').checked = state.style.showLeader;
  $('style-overlay').hidden = false;
});
$('style-close').addEventListener('click', () => { $('style-overlay').hidden = true; });
$('sty-size').addEventListener('input', e => { state.style.bubbleR  = +e.target.value; $('sty-size-val').textContent = e.target.value; render(); });
$('sty-font').addEventListener('input', e => { state.style.fontSize  = +e.target.value; $('sty-font-val').textContent = e.target.value; render(); });
$('sty-opacity').addEventListener('input', e => { state.style.opacity = +e.target.value; $('sty-opacity-val').textContent = e.target.value + '%'; render(); });
$('sty-leader').addEventListener('change', e => { state.style.showLeader = e.target.checked; render(); });

// ── AI 自动识别 ────────────────────────────────────────────────────────────────
$('btn-ai-analyze').addEventListener('click', async () => {
  if (!state.imgW) return;
  const cfg = loadConfig();
  if (!cfg.api_key) { alert('请先点击「⚙️ 设置」配置 API Key'); return; }

  const off = document.createElement('canvas');
  off.width = state.imgW; off.height = state.imgH;
  off.getContext('2d').drawImage(drawingImg, 0, 0);
  const imageDataUrl = off.toDataURL('image/png');

  aiOverlay.hidden = false;
  aiStatus.textContent = '正在分析图纸，Claude 识别中…';
  $('btn-ai-analyze').disabled = true;
  $('btn-ai-analyze').classList.add('loading');
  setWorkflowStep(1);

  const ws1 = $('ws-1');
  ws1.classList.add('loading');

  try {
    const resp = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: imageDataUrl,
        provider: cfg.provider || 'openai',
        base_url: cfg.base_url || '',
        api_key:  cfg.api_key,
        model:    cfg.model || '',
      }),
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw new Error(data.error || `HTTP ${resp.status}`);

    ws1.classList.remove('loading');
    setWorkflowStep(2);

    const items = data.annotations || [];
    if (!items.length) { alert('未识别到标注，请尝试更清晰的图纸。'); return; }

    let append = false;
    if (state.annotations.length > 0)
      append = confirm(`识别到 ${items.length} 个标注。\n确定=追加到已有标注，取消=替换全部`);

    if (!append) { state.annotations = []; state.nextNum = 1; }

    for (const item of items) {
      addAnnotation(item.x_pct * state.imgW, item.y_pct * state.imgH, {
        value:     item.value || item.label || '',
        upper_tol: item.upper_tol || '',
        lower_tol: item.lower_tol || '',
        type:      item.type || '尺寸',
        color:     item.color || typeColor(item.type),
      });
    }

    aiStatus.textContent = `识别完成，共 ${items.length} 个标注`;
    setWorkflowStep(3);
    $('btn-export-excel').disabled = false;
    renderTable(); render();

  } catch (e) {
    ws1.classList.remove('loading');
    alert(`AI 分析失败：${e.message}\n\n请确认后端已启动：python server.py`);
  } finally {
    setTimeout(() => { aiOverlay.hidden = true; }, 500);
    $('btn-ai-analyze').disabled = false;
    $('btn-ai-analyze').classList.remove('loading');
  }
});

// ── 导出 Excel ────────────────────────────────────────────────────────────────
function getImageBase64() {
  if (!drawingImg.src || !state.imgW) return null;
  try {
    const c = document.createElement('canvas');
    c.width = state.imgW; c.height = state.imgH;
    c.getContext('2d').drawImage(drawingImg, 0, 0);
    const dataUrl = c.toDataURL('image/jpeg', 0.85);
    return dataUrl.split(',')[1];
  } catch { return null; }
}

async function openExportModal() {
  if (!state.annotations.length) { alert('没有标注数据可导出'); return; }
  $('exp-date').value = new Date().toISOString().slice(0, 10);
  $('export-overlay').hidden = false;

  // 没有配置 API key 或没有图片，跳过 AI 识别
  const cfg = loadConfig();
  if (!cfg.api_key) return;
  const imgB64 = getImageBase64();
  if (!imgB64) return;

  const hint = $('exp-ai-hint');
  hint.hidden = false;

  // 15 秒超时，防止请求挂起
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);

  try {
    const resp = await fetch(`${API_BASE}/api/extract-meta`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_b64: imgB64,
        media_type: 'image/jpeg',
        provider: cfg.provider || 'openai',
        base_url: cfg.base_url || '',
        api_key:  cfg.api_key,
        model:    cfg.model    || '',
      })
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const meta = await resp.json();
    // 只填入空字段，不覆盖用户已手动填写的内容
    const map = { name:'exp-name', drawing:'exp-drawing', material:'exp-material',
                  quantity:'exp-quantity', sample:'exp-sample', batch:'exp-batch' };
    for (const [key, id] of Object.entries(map)) {
      if (!$(id).value && meta[key]) $(id).value = meta[key];
    }
  } catch { /* 识别超时或失败，静默忽略 */ }
  finally {
    clearTimeout(timer);
    hint.hidden = true;
  }
}

function formatTol(ann) {
  const u = (ann.upper_tol || '').trim();
  const l = (ann.lower_tol || '').trim();
  if (!u && !l) return '';
  if (u === l) return u; // 完全相同直接显示
  // 检查是否对称 ±
  const uNum = parseFloat(u);
  const lNum = parseFloat(l);
  if (!isNaN(uNum) && !isNaN(lNum) && Math.abs(uNum) === Math.abs(lNum)) {
    return `±${Math.abs(uNum)}`;
  }
  if (u && l) return `${u}/${l}`;
  return u || l;
}

async function doExportExcel() {
  const name      = $('exp-name').value.trim();
  const drawing   = $('exp-drawing').value.trim();
  const material  = $('exp-material').value.trim();
  const quantity  = $('exp-quantity').value.trim();
  const sample    = $('exp-sample').value.trim();
  const batch     = $('exp-batch').value.trim();
  const inspector = $('exp-inspector').value.trim();
  const reviewer  = $('exp-reviewer').value.trim();
  const date      = $('exp-date').value || new Date().toISOString().slice(0, 10);

  // 必填校验
  const missing = [];
  if (!name)      missing.push('名称');
  if (!drawing)   missing.push('图号');
  if (!material)  missing.push('材质');
  if (!quantity)  missing.push('数量');
  if (!sample && !batch) missing.push('样品或批次号（至少填一项）');
  if (!inspector) missing.push('检验员');
  if (missing.length) {
    alert('以下必填项未填写：\n• ' + missing.join('\n• '));
    return;
  }

  $('export-overlay').hidden = true;
  const btn = $('export-confirm');
  btn.disabled = true;
  btn.textContent = '生成中…';

  try {
    const resp = await fetch(`${API_BASE}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        annotations: state.annotations,
        meta: { name, drawing, material, quantity, sample, batch, date, inspector, reviewer }
      })
    });
    if (!resp.ok) throw new Error(await resp.text());

    const blob = await resp.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `林海日常检验记录_${date}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    setWorkflowStep(4);
  } catch (e) {
    alert('导出失败：' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '导出 Excel';
  }
}

$('btn-export-excel').addEventListener('click', openExportModal);
$('btn-export-excel2').addEventListener('click', openExportModal);

$('export-cancel').addEventListener('click', () => { $('export-overlay').hidden = true; });
$('export-confirm').addEventListener('click', doExportExcel);

// ── API 设置面板 ──────────────────────────────────────────────────────────────
$('btn-settings').addEventListener('click', () => {
  const cfg = loadConfig();
  $('cfg-provider').value = cfg.provider || 'openai';
  $('cfg-base-url').value = cfg.base_url || '';
  $('cfg-api-key').value  = cfg.api_key  || '';
  $('cfg-model').value    = cfg.model    || '';
  $('test-result').textContent = '';
  $('settings-overlay').hidden = false;
});
$('settings-cancel').addEventListener('click', () => { $('settings-overlay').hidden = true; });
$('settings-overlay').addEventListener('click', e => { if (e.target === $('settings-overlay')) $('settings-overlay').hidden = true; });
$('settings-save').addEventListener('click', () => {
  if (!$('cfg-api-key').value.trim()) { alert('请填写 API Key'); return; }
  saveConfig({ provider: $('cfg-provider').value, base_url: $('cfg-base-url').value.trim(), api_key: $('cfg-api-key').value.trim(), model: $('cfg-model').value.trim() });
  $('settings-overlay').hidden = true;
});

$('btn-test-conn').addEventListener('click', async () => {
  const tr = $('test-result');
  if (!$('cfg-api-key').value.trim()) { tr.className = 'fail'; tr.textContent = '❌ 请先填写 API Key'; return; }
  $('btn-test-conn').disabled = true;
  tr.className = 'checking'; tr.textContent = '检测中…';
  try {
    const resp = await fetch(`${API_BASE}/api/test`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: $('cfg-provider').value, base_url: $('cfg-base-url').value.trim(), api_key: $('cfg-api-key').value.trim(), model: $('cfg-model').value.trim() }),
    });
    const data = await resp.json();
    if (data.ok) { tr.className = 'ok'; tr.textContent = `✅ 连接成功，模型回复：「${data.reply}」`; }
    else { tr.className = 'fail'; tr.textContent = `❌ ${data.error}`; }
  } catch (e) {
    tr.className = 'fail'; tr.textContent = `❌ 无法连接后端：${e.message}`;
  } finally {
    $('btn-test-conn').disabled = false;
  }
});
