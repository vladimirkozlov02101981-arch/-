'use strict';
/* =========================================================
   Проверка проходимости карты.
   Строит граф всех точек, где может стоять боец, по его реальной
   физике (общие функции stepFrom / bodyFree / onGround / ladderTopExit):
   ходьба с подъёмом на уступы, прыжки, падения, лестницы.
   Ловушка — место, откуда нельзя вернуться в основную часть карты
   (без джетпака, телепорта и балок).
   ========================================================= */
const NavCheck = {
  analyze(g, opts = {}) {
    const T = g.terrain, W = g.W, waterY = g.waterY, grav = g.gravity;
    const STEP = opts.step || 3;
    const nodes = [], cols = new Map();
    for (let x = 6; x < W - 6; x += STEP) {
      const list = [];
      for (let y = 12; y < waterY - 4; y++) {
        if (!T.isSolid(x, y) || T.isSolid(x, y - 1)) continue;
        // на склоне боец стоит чуть выше верхнего пикселя столбца — опирается на соседнюю ногу
        for (let sy = y; sy >= y - 14; sy--) {
          if (!bodyFree(T, x, sy)) continue;
          if (onGround(T, x, sy) && (!list.length || nodes[list[list.length - 1]].y !== sy)) { list.push(nodes.length); nodes.push({ x, y: sy, out: [] }); }
          break;
        }
      }
      cols.set(x, list);
    }
    const colOf = (x) => Math.round((x - 6) / STEP) * STEP + 6;
    const nodeAt = (x, y) => {
      const c0 = colOf(x); let best = -1, bd = 1e9;
      for (let k = -3; k <= 3; k++) {
        for (const i of cols.get(c0 + k * STEP) || []) { const dy = Math.abs(nodes[i].y - y); if (dy > 12) continue; const d = dy + Math.abs(nodes[i].x - x) * 0.5; if (d < bd) { bd = d; best = i; } }
      }
      return best;
    };
    // полёт по правилам Soldier.updateAir (состояние 'air'): точка приземления или null (вода/край)
    const fly = (x, y, vx, vy, depth = 0) => {
      const dt = 1 / 60;
      for (let f = 0; f < 600; f++) {
        vy = Math.min(vy + grav * dt, 1500);
        const n = Math.max(1, Math.ceil(Math.max(Math.abs(vx), Math.abs(vy)) * dt / 2));
        for (let i = 0; i < n; i++) {
          const nx = x + vx * dt / n, ny = y + vy * dt / n;
          if (bodyFree(T, nx, ny)) { x = nx; y = ny; if (vy > 0 && onGround(T, x, y)) return { x, y }; continue; }
          if (bodyFree(T, x, ny)) { y = ny; vx = 0; continue; }
          if (bodyFree(T, nx, y)) {
            x = nx; if (vy < 0) { vy = -vy * 0.15; continue; }
            // «приземлился» без опоры — дальше падает отвесно
            return onGround(T, x, y) || depth > 3 ? { x, y } : fly(x, y, 0, 0, depth + 1);
          }
          if (vy > 0) return onGround(T, x, y) || depth > 3 ? { x, y } : fly(x, y, 0, 0, depth + 1);
          vx *= -0.3; vy *= -0.3; break;
        }
        if (y - 8 > waterY || x < -40 || x > W + 40) return null;
      }
      return null;
    };
    const walk = (x, y, dir, n) => {
      for (let i = 0; i < n; i++) {
        const p = stepFrom(T, x, y, dir);
        if (!p) return null;
        x = p.x; y = p.y;
        if (!onGround(T, x, y)) return fly(x, y, dir * 45, 0);
      }
      return { x, y };
    };
    const link = (a, p) => { if (!p) return; const b = nodeAt(p.x, p.y); if (b >= 0 && b !== a && !nodes[a].out.includes(b)) nodes[a].out.push(b); };
    nodes.forEach((nd, i) => {
      for (const d of [-1, 1]) {
        link(i, walk(nd.x, nd.y, d, STEP));
        link(i, fly(nd.x, nd.y - 1, d * JUMP_VX, -JUMP_VY));
      }
    });
    // лестницы: каждый свободный отрезок шахты — виртуальный узел «на лестнице»
    const virt = [];
    for (const l of g.map.ladders || []) {
      const ys = []; for (let y = Math.ceil(l.y1 - 8); y <= l.y2 + 8; y += 2) ys.push(y);
      let seg = [];
      const flush = () => {
        if (!seg.length) return;
        const v = nodes.length; nodes.push({ x: l.x, y: seg[0], out: [], v: true }); virt.push(v);
        const y0 = seg[0], y1 = seg[seg.length - 1];
        // вход: кто стоит у лестницы на высоте отрезка
        for (let i = 0; i < v; i++) { const nd = nodes[i]; if (Math.abs(nd.x - l.x) < 19 && nd.y >= y0 - 1 && nd.y <= y1 + 1 && bodyFree(T, l.x, nd.y)) nd.out.push(v); }
        const out = (p) => { if (!p) return; const b = nodeAt(p.x, p.y); if (b >= 0 && !nodes[v].out.includes(b)) nodes[v].out.push(b); };
        for (let k = 0; k < seg.length; k += 3) {
          const y = seg[k];
          for (const d of [-1, 1]) {
            const x = bodyFree(T, l.x + d * 12, y) ? l.x + d * 12 : l.x;
            out(fly(x, y, d * 75, 0));
            out(fly(l.x, y - 1, d * JUMP_VX, -JUMP_VY));
          }
        }
        if (y0 <= l.y1 - 4) for (const d of [-1, 1]) out(ladderTopExit(T, l, d));
        if (onGround(T, l.x, y1)) out({ x: l.x, y: y1 });
        seg = [];
      };
      for (const y of ys) { if (bodyFree(T, l.x, y)) seg.push(y); else flush(); }
      flush();
    }
    // сильно связные компоненты (Тарьян, итеративно)
    const N = nodes.length, idx = new Int32Array(N).fill(-1), low = new Int32Array(N), comp = new Int32Array(N).fill(-1), onSt = new Uint8Array(N);
    const st = []; let counter = 0, ncomp = 0;
    for (let s = 0; s < N; s++) {
      if (idx[s] >= 0) continue;
      const work = [[s, 0]]; idx[s] = low[s] = counter++; st.push(s); onSt[s] = 1;
      while (work.length) {
        const top = work[work.length - 1]; const v = top[0];
        if (top[1] < nodes[v].out.length) {
          const w = nodes[v].out[top[1]++];
          if (idx[w] < 0) { idx[w] = low[w] = counter++; st.push(w); onSt[w] = 1; work.push([w, 0]); }
          else if (onSt[w]) low[v] = Math.min(low[v], idx[w]);
        } else {
          work.pop(); if (work.length) { const u = work[work.length - 1][0]; low[u] = Math.min(low[u], low[v]); }
          if (low[v] === idx[v]) { let w; do { w = st.pop(); onSt[w] = 0; comp[w] = ncomp; } while (w !== v); ncomp++; }
        }
      }
    }
    const size = new Int32Array(ncomp); for (let i = 0; i < N; i++) if (!nodes[i].v) size[comp[i]]++;
    let main = 0; for (let c = 1; c < ncomp; c++) if (size[c] > size[main]) main = c;
    // кто может добраться до главного компонента (обратный обход)
    const rev = nodes.map(() => []); nodes.forEach((nd, i) => { for (const j of nd.out) rev[j].push(i); });
    const reach = new Uint8Array(N); const q = [];
    for (let i = 0; i < N; i++) if (comp[i] === main) { reach[i] = 1; q.push(i); }
    while (q.length) { const v = q.pop(); for (const u of rev[v]) if (!reach[u]) { reach[u] = 1; q.push(u); } }
    // куда можно попасть из главного компонента
    const fromMain = new Uint8Array(N); const q2 = [];
    for (let i = 0; i < N; i++) if (comp[i] === main) { fromMain[i] = 1; q2.push(i); }
    while (q2.length) { const v = q2.pop(); for (const u of nodes[v].out) if (!fromMain[u]) { fromMain[u] = 1; q2.push(u); } }
    const cluster = (flag) => {
      const seen = new Uint8Array(N), out = [];
      for (let i = 0; i < N; i++) {
        if (nodes[i].v || !flag(i) || seen[i]) continue;
        const cl = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9, n: 0 }; const st2 = [i]; seen[i] = 1;
        while (st2.length) {
          const v = st2.pop(); const nd = nodes[v]; cl.n++;
          cl.x0 = Math.min(cl.x0, nd.x); cl.x1 = Math.max(cl.x1, nd.x); cl.y0 = Math.min(cl.y0, nd.y); cl.y1 = Math.max(cl.y1, nd.y);
          for (const c of [nd.x - STEP, nd.x, nd.x + STEP]) for (const j of cols.get(c) || []) if (!seen[j] && flag(j) && Math.abs(nodes[j].y - nd.y) < 14) { seen[j] = 1; st2.push(j); }
        }
        out.push(cl);
      }
      return out;
    };
    const traps = cluster(i => !reach[i]);
    const isolated = cluster(i => reach[i] && !fromMain[i]);
    const real = nodes.length - virt.length;
    return { nodes, comp, main, reach, fromMain, traps, isolated, total: real, mainSize: size[main] };
  },
  /** рисует результат поверх карты: зелёный — связано, жёлтый — только выход, красный — ловушка */
  draw(c, res) {
    for (let i = 0; i < res.nodes.length; i++) {
      const nd = res.nodes[i]; if (nd.v) continue;
      c.fillStyle = !res.reach[i] ? '#ff2d2d' : !res.fromMain[i] ? '#ffd23a' : 'rgba(80,255,120,0.55)';
      c.fillRect(nd.x - 1.5, nd.y - 3, 3, 3);
    }
    c.strokeStyle = '#ff2d2d'; c.lineWidth = 3;
    for (const t of res.traps) c.strokeRect(t.x0 - 20, t.y0 - 40, t.x1 - t.x0 + 40, t.y1 - t.y0 + 50);
  },
};
