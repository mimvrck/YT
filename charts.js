/* charts.js — tiny canvas chart renderer. No external chart library. */

function drawBarChart(canvas, data, opts = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const pad = { top: 16, right: 12, bottom: 32, left: 36 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const max = opts.max || Math.max(1, ...data.map((d) => d.value));
  const barGap = 10;
  const barW = data.length ? (chartW / data.length) - barGap : 0;

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(232,234,238,0.4)';
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(max - (max / 4) * i), pad.left - 6, y + 3);
  }

  data.forEach((d, i) => {
    const x = pad.left + i * (barW + barGap) + barGap / 2;
    const barH = chartH * (d.value / max);
    const y = pad.top + chartH - barH;
    ctx.fillStyle = d.color || opts.color || '#C9A227';
    ctx.fillRect(x, y, barW, barH);

    ctx.fillStyle = 'rgba(232,234,238,0.65)';
    ctx.font = '10px "IBM Plex Sans", sans-serif';
    ctx.textAlign = 'center';
    const label = d.label.length > 10 ? d.label.slice(0, 9) + '…' : d.label;
    ctx.fillText(label, x + barW / 2, h - pad.bottom + 14);
  });
}

function drawLineChart(canvas, series, opts = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  if (!series.length) return;

  const pad = { top: 16, right: 16, bottom: 28, left: 36 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const values = series.map((s) => s.value);
  const max = opts.max || Math.max(1, ...values);
  const min = opts.min !== undefined ? opts.min : Math.min(0, ...values);

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(232,234,238,0.4)';
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(max - ((max - min) / 4) * i), pad.left - 6, y + 3);
  }

  const stepX = series.length > 1 ? chartW / (series.length - 1) : 0;
  ctx.beginPath();
  ctx.strokeStyle = opts.color || '#C9A227';
  ctx.lineWidth = 2;
  series.forEach((pt, i) => {
    const x = pad.left + stepX * i;
    const norm = (pt.value - min) / (max - min || 1);
    const y = pad.top + chartH - norm * chartH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = opts.color || '#C9A227';
  series.forEach((pt, i) => {
    const x = pad.left + stepX * i;
    const norm = (pt.value - min) / (max - min || 1);
    const y = pad.top + chartH - norm * chartH;
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = 'rgba(232,234,238,0.5)';
  ctx.font = '10px "IBM Plex Sans", sans-serif';
  ctx.textAlign = 'center';
  series.forEach((pt, i) => {
    if (series.length > 8 && i % Math.ceil(series.length / 8) !== 0) return;
    const x = pad.left + stepX * i;
    ctx.fillText(pt.label, x, h - pad.bottom + 16);
  });
}

window.Charts = { drawBarChart, drawLineChart };
